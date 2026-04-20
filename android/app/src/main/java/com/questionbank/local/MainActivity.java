package com.questionbank.local;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(android.os.Bundle savedInstanceState) {
        registerPlugin(SmartCapturePlugin.class);
        registerPlugin(Gemma4Plugin.class);
        super.onCreate(savedInstanceState);
    }

    @Override
    protected void onNewIntent(android.content.Intent intent) {
        super.onNewIntent(intent);
        if ("COM.QUESTIONBANK.AUTOTEST".equals(intent.getAction())) {
            getBridge().getWebView().post(() -> {
                getBridge().getWebView().evaluateJavascript("window.runFullAIAutomation()", null);
            });
        }
    }
}
