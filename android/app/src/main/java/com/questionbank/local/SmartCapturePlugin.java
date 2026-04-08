package com.questionbank.local;

import android.Manifest;
import android.content.Intent;
import android.net.Uri;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.FileUtils;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.io.File;

@CapacitorPlugin(
    name = "SmartCapture",
    permissions = {
        @Permission(strings = { Manifest.permission.CAMERA }, alias = SmartCapturePlugin.CAMERA)
    }
)
public class SmartCapturePlugin extends Plugin {
    static final String CAMERA = "camera";

    @PluginMethod
    public void captureQuestion(PluginCall call) {
        if (getPermissionState(CAMERA) != PermissionState.GRANTED) {
            requestPermissionForAlias(CAMERA, call, "cameraPermissionCallback");
            return;
        }
        launchSmartCapture(call);
    }

    @PermissionCallback
    private void cameraPermissionCallback(PluginCall call) {
        if (getPermissionState(CAMERA) != PermissionState.GRANTED) {
            call.reject("User denied access to camera");
            return;
        }
        launchSmartCapture(call);
    }

    private void launchSmartCapture(PluginCall call) {
        Intent intent = new Intent(getContext(), SmartCaptureActivity.class);
        startActivityForResult(call, intent, "handleCaptureResult");
    }

    @ActivityCallback
    private void handleCaptureResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result == null || result.getResultCode() != android.app.Activity.RESULT_OK || result.getData() == null) {
            call.reject("User cancelled smart capture");
            return;
        }
        Intent data = result.getData();
        String filePath = data.getStringExtra(SmartCaptureActivity.EXTRA_FILE_PATH);
        if (filePath == null || filePath.isEmpty()) {
            call.reject("Smart capture returned no image");
            return;
        }
        File imageFile = new File(filePath);
        Uri imageUri = Uri.fromFile(imageFile);
        JSObject ret = new JSObject();
        ret.put("path", imageUri.toString());
        ret.put("webPath", FileUtils.getPortablePath(getContext(), bridge.getLocalUrl(), imageUri));
        ret.put("width", data.getIntExtra(SmartCaptureActivity.EXTRA_IMAGE_WIDTH, 0));
        ret.put("height", data.getIntExtra(SmartCaptureActivity.EXTRA_IMAGE_HEIGHT, 0));
        if (data.hasExtra(SmartCaptureActivity.EXTRA_RECT_LEFT)) {
            JSObject rect = new JSObject();
            rect.put("x", data.getIntExtra(SmartCaptureActivity.EXTRA_RECT_LEFT, 0));
            rect.put("y", data.getIntExtra(SmartCaptureActivity.EXTRA_RECT_TOP, 0));
            rect.put("width", data.getIntExtra(SmartCaptureActivity.EXTRA_RECT_WIDTH, 0));
            rect.put("height", data.getIntExtra(SmartCaptureActivity.EXTRA_RECT_HEIGHT, 0));
            ret.put("cropRect", rect);
        }
        call.resolve(ret);
    }
}
