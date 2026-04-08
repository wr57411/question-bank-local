package com.questionbank.local;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(android.os.Bundle savedInstanceState) {
        registerPlugin(SmartCapturePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
