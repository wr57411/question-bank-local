package com.questionbank.local;

public class LlamaBridge {
    static {
        System.loadLibrary("llama_jni");
    }

    public static native boolean loadModel(String path);
    public static native String generate(String prompt, int maxTokens);
    public static native void unloadModel();
    public static native boolean isLoaded();
}
