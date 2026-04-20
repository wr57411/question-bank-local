package com.questionbank.local;

import android.content.Context;
import android.content.SharedPreferences;
import android.util.Log;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.mediapipe.tasks.genai.llminference.LlmInference;
import com.google.mediapipe.tasks.genai.llminference.LlmInference.LlmInferenceOptions;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.ArrayList;
import java.util.List;

@CapacitorPlugin(name = "Gemma4")
public class Gemma4Plugin extends Plugin {

    private static final String TAG = "Gemma4";
    private static final String PREF_NAME = "Gemma4Prefs";
    private static final String KEY_MODEL_DOWNLOADED = "model_downloaded";
    private static final String MODEL_DIR = "gemma";
    private static final String MODEL_FILE = "gemma-e2b.task";

    private LlmInference llmInference;
    private boolean isEngineReady = false;

    private File getModelFile() {
        return new File(getContext().getFilesDir(), MODEL_DIR + "/" + MODEL_FILE);
    }

    // ========== 插件方法 ==========

    @PluginMethod
    public void checkModelStatus(PluginCall call) {
        File modelFile = getModelFile();
        boolean exists = modelFile.exists() && modelFile.length() > 100_000_000;

        JSObject ret = new JSObject();
        ret.put("ready", isEngineReady);
        ret.put("downloaded", exists);
        ret.put("path", modelFile.getAbsolutePath());
        ret.put("size", exists ? modelFile.length() : 0);
        call.resolve(ret);
    }

    @PluginMethod
    public void discoverModel(PluginCall call) {
        File modelFile = getModelFile();
        boolean found = modelFile.exists() && modelFile.length() > 100_000_000;

        if (found && !isEngineReady) {
            initEngine(modelFile.getAbsolutePath());
        }

        JSObject ret = new JSObject();
        ret.put("found", found);
        ret.put("path", modelFile.getAbsolutePath());
        call.resolve(ret);
    }

    @PluginMethod
    public void downloadModel(PluginCall call) {
        String url = call.getString("url", "");
        if (url.isEmpty()) {
            call.reject("未提供下载地址");
            return;
        }

        new Thread(() -> {
            try {
                File modelFile = getModelFile();
                File dir = modelFile.getParentFile();
                if (!dir.exists()) dir.mkdirs();

                HttpURLConnection conn = (HttpURLConnection) new URL(url).openConnection();
                conn.connect();
                long total = conn.getContentLength();
                InputStream in = conn.getInputStream();
                FileOutputStream out = new FileOutputStream(modelFile);

                byte[] buf = new byte[8192];
                long downloaded = 0;
                int len;
                while ((len = in.read(buf)) != -1) {
                    out.write(buf, 0, len);
                    downloaded += len;
                    if (total > 0) {
                        int pct = (int) (downloaded * 100 / total);
                        JSObject progress = new JSObject();
                        progress.put("progress", pct);
                        progress.put("downloaded", downloaded);
                        progress.put("total", total);
                        notifyListeners("downloadProgress", progress);
                    }
                }
                out.close();
                in.close();

                getContext().getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE)
                    .edit().putBoolean(KEY_MODEL_DOWNLOADED, true).apply();

                Log.i(TAG, "模型下载完成: " + modelFile.getAbsolutePath());
                initEngine(modelFile.getAbsolutePath());

                JSObject done = new JSObject();
                done.put("progress", 100);
                notifyListeners("downloadProgress", done);

            } catch (Exception e) {
                Log.e(TAG, "下载失败", e);
                JSObject err = new JSObject();
                err.put("error", e.getMessage());
                notifyListeners("downloadError", err);
            }
        }).start();

        call.resolve();
    }

    @PluginMethod
    public void analyzeQuestion(PluginCall call) {
        if (!isEngineReady || llmInference == null) {
            call.reject("引擎未就绪");
            return;
        }

        String imageBase64 = call.getString("imageBase64", "");

        new Thread(() -> {
            try {
                String prompt;
                if (!imageBase64.isEmpty()) {
                    prompt = "请分析这道题目，用中文回答：1.题目所属学科和知识点 2.难度等级(1-5) 3.一句话摘要\n[图片数据长度: " + imageBase64.length() + " 字符]";
                } else {
                    prompt = "请等待题目图片";
                }

                String result = llmInference.generateResponse(prompt);

                JSObject ret = new JSObject();
                ret.put("summary", result);
                ret.put("difficulty", 3);
                JSArray tags = new JSArray();
                tags.put("AI分析");
                ret.put("tags", tags);
                call.resolve(ret);

            } catch (Exception e) {
                Log.e(TAG, "推理失败", e);
                call.reject("推理失败: " + e.getMessage());
            }
        }).start();
    }

    @PluginMethod
    public void recommendQuestions(PluginCall call) {
        if (!isEngineReady || llmInference == null) {
            call.reject("引擎未就绪");
            return;
        }

        String requirement = call.getString("requirement", "");
        String candidatesJson = call.getString("candidatesJson", "[]");

        new Thread(() -> {
            try {
                String prompt = "根据以下需求: " + requirement + "\n从候选题目中推荐最合适的，请说明理由。\n候选题目: " + candidatesJson.substring(0, Math.min(500, candidatesJson.length()));
                String result = llmInference.generateResponse(prompt);

                JSObject ret = new JSObject();
                ret.put("reason", result);

                JSArray ids = new JSArray();
                try {
                    org.json.JSONArray candidates = new org.json.JSONArray(candidatesJson);
                    for (int i = 0; i < Math.min(3, candidates.length()); i++) {
                        org.json.JSONObject obj = candidates.getJSONObject(i);
                        if (obj.has("id")) ids.put(obj.getString("id"));
                    }
                } catch (Exception e) {}

                ret.put("recommended_ids", ids);
                call.resolve(ret);

            } catch (Exception e) {
                Log.e(TAG, "推荐失败", e);
                call.reject("推荐失败: " + e.getMessage());
            }
        }).start();
    }

    @PluginMethod
    public void unloadModel(PluginCall call) {
        if (llmInference != null) {
            try { llmInference.close(); } catch (Exception e) {}
            llmInference = null;
        }
        isEngineReady = false;
        Log.i(TAG, "模型已卸载");
        call.resolve();
    }

    // ========== 内部方法 ==========

    private void initEngine(String modelPath) {
        if (isEngineReady) return;
        Log.i(TAG, "开始加载模型: " + modelPath);

        new Thread(() -> {
            try {
                LlmInferenceOptions options = LlmInferenceOptions.builder()
                    .setModelPath(modelPath)
                    .setMaxTokens(1024)
                    .build();

                llmInference = LlmInference.createFromOptions(getContext(), options);
                isEngineReady = true;
                Log.i(TAG, "Gemma 引擎加载成功");

                JSObject event = new JSObject();
                event.put("ready", true);
                notifyListeners("engineReady", event);

            } catch (Exception e) {
                Log.e(TAG, "模型加载失败", e);
                isEngineReady = false;

                JSObject event = new JSObject();
                event.put("error", e.getMessage());
                notifyListeners("engineError", event);
            }
        }).start();
    }
}
