package com.questionbank.local;

import android.content.Intent;
import android.os.Bundle;
import android.util.Log;
import com.getcapacitor.BridgeActivity;
import java.util.ArrayList;

public class MainActivity extends BridgeActivity {
    private static final String TAG = "MainActivity";

    @Override
    protected void onCreate(android.os.Bundle savedInstanceState) {
        registerPlugin(SmartCapturePlugin.class);
        registerPlugin(Gemma4Plugin.class);
        super.onCreate(savedInstanceState);
        handlePendingPhotosIntent(getIntent());
    }

    @Override
    protected void onNewIntent(android.content.Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);

        if ("COM.QUESTIONBANK.AUTOTEST".equals(intent.getAction())) {
            getBridge().getWebView().post(() -> {
                getBridge().getWebView().evaluateJavascript("window.runFullAIAutomation()", null);
            });
        }

        handlePendingPhotosIntent(intent);
    }

    private void handlePendingPhotosIntent(Intent intent) {
        if (intent == null) return;

        ArrayList<String> paths = intent.getStringArrayListExtra(QuickCaptureActivity.EXTRA_PENDING_PATHS);
        String groupInfo = intent.getStringExtra(QuickCaptureActivity.EXTRA_GROUP_INFO);

        if (paths != null && !paths.isEmpty()) {
            Log.d(TAG, "收到 " + paths.size() + " 张待处理照片");

            // 构建 JS 调用
            StringBuilder jsBuilder = new StringBuilder();
            jsBuilder.append("window.importPendingPhotos(");

            // 转换路径列表为 JSON 数组
            jsBuilder.append("[");
            for (int i = 0; i < paths.size(); i++) {
                if (i > 0) jsBuilder.append(",");
                jsBuilder.append("\"").append(escapeJs(paths.get(i))).append("\"");
            }
            jsBuilder.append("]");

            // 添加分组信息
            if (groupInfo != null) {
                jsBuilder.append(",").append("\"").append(escapeJs(groupInfo)).append("\"");
            }

            jsBuilder.append(")");

            final String jsCode = jsBuilder.toString();
            Log.d(TAG, "执行 JS: " + jsCode);

            // 延迟执行，等待 WebView 加载完成
            getBridge().getWebView().postDelayed(() -> {
                getBridge().getWebView().evaluateJavascript(jsCode, result -> {
                    Log.d(TAG, "JS 执行结果: " + result);
                });
            }, 1000);
        }
    }

    private String escapeJs(String str) {
        if (str == null) return "";
        return str.replace("\\", "\\\\").replace("\"", "\\\"").replace("\n", "\\n").replace("\r", "\\r");
    }
}
