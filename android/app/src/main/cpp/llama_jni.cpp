#include <jni.h>
#include <string>
#include <vector>
#include <mutex>
#include <cstdio>
#include <android/log.h>
#include "llama.h"
#include "ggml.h"

#define TAG_JNI "Gemma4_JNI"
#define LOGI(...) __android_log_print(ANDROID_LOG_INFO, TAG_JNI, __VA_ARGS__)
#define LOGE(...) __android_log_print(ANDROID_LOG_ERROR, TAG_JNI, __VA_ARGS__)

static llama_model * g_model = nullptr;
static std::mutex g_mutex;
static JavaVM * g_jvm = nullptr;
static jobject g_callback = nullptr;

// 进度回调
static void report_progress(int step, int total, const char* status) {
    if (!g_jvm || !g_callback) return;
    JNIEnv *env;
    bool needsDetach = false;
    if (g_jvm->GetEnv((void**)&env, JNI_VERSION_1_6) != JNI_OK) {
        g_jvm->AttachCurrentThread(&env, nullptr);
        needsDetach = true;
    }
    jclass clazz = env->GetObjectClass(g_callback);
    jmethodID method = env->GetMethodID(clazz, "onProgress", "(IILjava/lang/String;)V");
    if (method) {
        jstring jstatus = env->NewStringUTF(status);
        env->CallVoidMethod(g_callback, method, step, total, jstatus);
        env->DeleteLocalRef(jstatus);
    }
    env->DeleteLocalRef(clazz);
    if (needsDetach) g_jvm->DetachCurrentThread();
}

static void my_ggml_log_callback(enum ggml_log_level level, const char * text, void * user_data) {
    __android_log_print(
        level == GGML_LOG_LEVEL_ERROR ? ANDROID_LOG_ERROR : ANDROID_LOG_INFO,
        "GGML", "%s", text);
}

extern "C" {

JNIEXPORT jboolean JNICALL
Java_com_questionbank_local_LlamaBridge_loadModel(JNIEnv *env, jclass clazz, jstring jpath) {
    const char *path = env->GetStringUTFChars(jpath, nullptr);
    LOGI("开始加载模型: %s", path);
    std::lock_guard<std::mutex> lock(g_mutex);

    if (!g_jvm) env->GetJavaVM(&g_jvm);

    llama_model_params model_params = llama_model_default_params();
    model_params.n_gpu_layers = 0;

    LOGI("调用 llama_model_load_from_file...");
    llama_log_set(my_ggml_log_callback, nullptr);
    g_model = llama_model_load_from_file(path, model_params);
    env->ReleaseStringUTFChars(jpath, path);

    if (!g_model) {
        LOGE("llama_model_load_from_file 返回 NULL，模型加载失败");
        return JNI_FALSE;
    }
    LOGI("模型加载成功");

    return JNI_TRUE;
}

JNIEXPORT void JNICALL
Java_com_questionbank_local_LlamaBridge_setProgressCallback(JNIEnv *env, jclass clazz, jobject callback) {
    std::lock_guard<std::mutex> lock(g_mutex);
    if (g_callback) { env->DeleteGlobalRef(g_callback); g_callback = nullptr; }
    if (callback) { g_callback = env->NewGlobalRef(callback); }
}

JNIEXPORT jstring JNICALL
Java_com_questionbank_local_LlamaBridge_generate(JNIEnv *env, jclass clazz, jstring jprompt, jint max_tokens) {
    const char *prompt_cstr = env->GetStringUTFChars(jprompt, nullptr);
    std::string prompt(prompt_cstr);
    env->ReleaseStringUTFChars(jprompt, prompt_cstr);

    std::lock_guard<std::mutex> lock(g_mutex);
    if (!g_model) {
        return env->NewStringUTF("ERROR: model not loaded");
    }

    // 每次推理创建新的 context，避免 KV cache 冲突
    llama_context_params ctx_params = llama_context_default_params();
    ctx_params.n_ctx = 2048;
    ctx_params.n_batch = 512;
    llama_context * ctx = llama_init_from_model(g_model, ctx_params);
    if (!ctx) {
        return env->NewStringUTF("ERROR: failed to create context");
    }

    const struct llama_vocab * vocab = llama_model_get_vocab(g_model);

    // Tokenize
    std::vector<llama_token> tokens(prompt.size() + 32);
    int n_tokens = llama_tokenize(vocab, prompt.c_str(), prompt.size(), tokens.data(), tokens.size(), true, true);
    if (n_tokens < 0) {
        tokens.resize(-n_tokens);
        n_tokens = llama_tokenize(vocab, prompt.c_str(), prompt.size(), tokens.data(), tokens.size(), true, true);
    }
    if (n_tokens < 0) {
        llama_free(ctx);
        return env->NewStringUTF("ERROR: tokenize failed");
    }
    tokens.resize(n_tokens);

    // Prepare batch
    llama_batch batch = llama_batch_init(n_tokens, 0, 1);
    for (int i = 0; i < n_tokens; i++) {
        batch.token[i] = tokens[i];
        batch.pos[i] = i;
        batch.n_seq_id[i] = 1;
        batch.seq_id[i][0] = 0;
        batch.logits[i] = (i == n_tokens - 1) ? 1 : 0;
    }
    batch.n_tokens = n_tokens;

    if (llama_decode(ctx, batch) != 0) {
        llama_batch_free(batch);
        llama_free(ctx);
        return env->NewStringUTF("ERROR: decode failed");
    }

    // Generate tokens
    std::string result;
    for (int i = 0; i < max_tokens; i++) {
        float * logits = llama_get_logits_ith(ctx, batch.n_tokens - 1);
        int n_vocab = llama_vocab_n_tokens(vocab);

        // Greedy sampling
        llama_token new_token = 0;
        float max_logit = logits[0];
        for (int t = 1; t < n_vocab; t++) {
            if (logits[t] > max_logit) {
                max_logit = logits[t];
                new_token = t;
            }
        }

        if (llama_vocab_is_eog(vocab, new_token)) break;

        // Decode token
        char buf[256];
        int n = llama_token_to_piece(vocab, new_token, buf, sizeof(buf), 0, false);
        if (n > 0) result.append(buf, n);

        // 每10个token报告一次进度
        if (i % 10 == 0) {
            char status[128];
            snprintf(status, sizeof(status), "已生成 %d 字", (int)result.size());
            report_progress(i, max_tokens, status);
        }

        // Next batch
        batch.token[0] = new_token;
        batch.pos[0] = n_tokens + i;
        batch.n_seq_id[0] = 1;
        batch.seq_id[0][0] = 0;
        batch.logits[0] = 1;
        batch.n_tokens = 1;

        if (llama_decode(ctx, batch) != 0) break;
    }

    llama_batch_free(batch);
    llama_free(ctx);
    return env->NewStringUTF(result.c_str());
}

JNIEXPORT void JNICALL
Java_com_questionbank_local_LlamaBridge_unloadModel(JNIEnv *env, jclass clazz) {
    std::lock_guard<std::mutex> lock(g_mutex);
    if (g_model) { llama_model_free(g_model); g_model = nullptr; }
    if (g_callback) { env->DeleteGlobalRef(g_callback); g_callback = nullptr; }
    LOGI("模型已卸载");
}

JNIEXPORT jboolean JNICALL
Java_com_questionbank_local_LlamaBridge_isLoaded(JNIEnv *env, jclass clazz) {
    return (g_model != nullptr) ? JNI_TRUE : JNI_FALSE;
}

}
