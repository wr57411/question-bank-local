package com.questionbank.local;

public class LlamaBridge {
    static {
        System.loadLibrary("llama_jni");
    }

    public interface ProgressCallback {
        void onProgress(int step, int total, String status);
    }

    public static native boolean loadModel(String path);
    public static native String generate(String prompt, int maxTokens);
    public static native void unloadModel();
    public static native boolean isLoaded();
    public static native void setProgressCallback(ProgressCallback callback);
}
