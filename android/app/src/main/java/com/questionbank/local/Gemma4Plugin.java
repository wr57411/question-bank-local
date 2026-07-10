package com.questionbank.local;

import android.os.Environment;
import android.util.Log;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

@CapacitorPlugin(name = "Gemma4")
public class Gemma4Plugin extends Plugin {

    private static final String TAG = "Gemma4";
    private static final String MODEL_FILENAME = "gemma-4-E2B-it-Q3_K_S.gguf";
    private ExecutorService executor;

    @Override
    public void load() {
        super.load();
        executor = Executors.newSingleThreadExecutor();
        executor.submit(() -> {
            try {
                Thread.sleep(3000);
                File modelFile = scanForModel();
                if (modelFile != null && !LlamaBridge.isLoaded()) {
                    System.out.println("[Gemma4] 启动自动加载模型: " + modelFile.getName());
                    LlamaBridge.loadModel(modelFile.getAbsolutePath());
                    System.out.println("[Gemma4] 模型加载完成, ready=" + LlamaBridge.isLoaded());
                }
            } catch (Exception e) {
                System.out.println("[Gemma4] 自动加载异常: " + e.getMessage());
            }
        });
    }

    private File scanForModel() {
        File downloadsDir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS);
        File model = new File(downloadsDir, MODEL_FILENAME);
        if (model.exists() && model.length() > 100_000_000) return model;
        return null;
    }

    @PluginMethod
    public void checkModelStatus(PluginCall call) {
        File modelFile = scanForModel();
        JSObject ret = new JSObject();
        ret.put("ready", LlamaBridge.isLoaded());
        ret.put("downloaded", modelFile != null);
        ret.put("path", modelFile != null ? modelFile.getAbsolutePath() : "");
        call.resolve(ret);
    }

    @PluginMethod
    public void discoverModel(PluginCall call) {
        if (android.os.Build.VERSION.SDK_INT >= 30) {
            if (!android.os.Environment.isExternalStorageManager()) {
                JSObject ret = new JSObject();
                ret.put("found", false);
                ret.put("ready", false);
                ret.put("error", "需要\"所有文件访问权限\"才能加载模型。请前往 设置 → 应用 → 本地题库 → 权限 → 所有文件访问 → 开启");
                call.resolve(ret);
                return;
            }
        }

        File modelFile = scanForModel();
        boolean found = modelFile != null;
        boolean loaded = false;

        if (found) {
            String path = modelFile.getAbsolutePath();
            String errorMsg = "";

            if (!LlamaBridge.isLoaded()) {
                try {
                    loaded = LlamaBridge.loadModel(path);
                } catch (UnsatisfiedLinkError e) {
                    errorMsg = "UnsatisfiedLinkError: " + e.getMessage();
                } catch (Throwable t) {
                    errorMsg = t.getClass().getSimpleName() + ": " + t.getMessage();
                }
            } else {
                loaded = true;
            }

            JSObject ret = new JSObject();
            ret.put("found", true);
            ret.put("ready", LlamaBridge.isLoaded());
            ret.put("error", errorMsg);
            call.resolve(ret);
            return;
        }

        JSObject ret = new JSObject();
        ret.put("found", found);
        ret.put("ready", LlamaBridge.isLoaded());
        call.resolve(ret);
    }

    @PluginMethod
    public void analyzeQuestion(PluginCall call) {
        if (!LlamaBridge.isLoaded()) {
            call.reject("引擎未就绪");
            return;
        }
        String prompt = call.getString("prompt", "请用中文分析这道题目");

        LlamaBridge.setProgressCallback((step, total, status) -> {
            JSObject event = new JSObject();
            event.put("step", step);
            event.put("total", total);
            event.put("status", status);
            notifyListeners("analyzeProgress", event);
        });

        executor.submit(() -> {
            try {
                String formatted = "<start_of_turn>user\n" + prompt + "<end_of_turn>\n<start_of_turn>model\n";
                String result = LlamaBridge.generate(formatted, 256);

                if (result.startsWith("ERROR:")) {
                    call.reject(result);
                    return;
                }

                JSObject ret = new JSObject();
                ret.put("summary", result);
                ret.put("difficulty", 3);
                ret.put("tags", new org.json.JSONArray());
                call.resolve(ret);
            } catch (Exception e) {
                Log.e(TAG, "推理失败", e);
                call.reject("推理失败: " + e.getMessage());
            }
        });
    }

    @PluginMethod
    public void recommendQuestions(PluginCall call) {
        if (!LlamaBridge.isLoaded()) {
            call.reject("引擎未就绪");
            return;
        }
        String requirement = call.getString("requirement", "");

        executor.submit(() -> {
            try {
                String formatted = "<start_of_turn>user\n推荐题目: " + requirement + "<end_of_turn>\n<start_of_turn>model\n";
                String result = LlamaBridge.generate(formatted, 256);

                if (result.startsWith("ERROR:")) {
                    call.reject(result);
                    return;
                }

                JSObject ret = new JSObject();
                ret.put("reason", result);
                call.resolve(ret);
            } catch (Exception e) {
                Log.e(TAG, "推理失败", e);
                call.reject("推理失败: " + e.getMessage());
            }
        });
    }

    @PluginMethod
    public void unloadModel(PluginCall call) {
        LlamaBridge.unloadModel();
        Log.i(TAG, "模型已卸载");
        call.resolve();
    }

    @Override
    protected void handleOnDestroy() {
        super.handleOnDestroy();
        if (executor != null && !executor.isShutdown()) {
            executor.shutdown();
        }
        try { LlamaBridge.unloadModel(); } catch (Throwable ignored) {}
    }
}
