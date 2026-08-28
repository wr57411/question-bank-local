package com.questionbank.local;

import android.Manifest;
import android.database.ContentObserver;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.provider.MediaStore;
import android.util.Log;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.RejectedExecutionException;

@CapacitorPlugin(
    name = "ScreenshotListener",
    permissions = {
        @Permission(strings = { Manifest.permission.READ_MEDIA_IMAGES }, alias = "readMedia"),
        @Permission(strings = { Manifest.permission.READ_EXTERNAL_STORAGE }, alias = "readStorage")
    }
)
public class ScreenshotListenerPlugin extends Plugin {

    private static final String TAG = "ScreenshotListener";
    private static final long MIN_INTERVAL_MS = 3000;
    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private ContentObserver observer;
    private long lastNotifyAt = 0;

    @Override
    public void load() {
        observer = new ContentObserver(new Handler(Looper.getMainLooper())) {
            @Override
            public void onChange(boolean selfChange, Uri uri) {
                handleMediaChange(uri);
            }
        };
        getContext().getApplicationContext().getContentResolver()
                .registerContentObserver(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, true, observer);
    }

    private void handleMediaChange(Uri uri) {
        if (uri == null) return;
        try {
            executor.execute(() -> {
                long now = SystemClock.elapsedRealtime();
                if (now - lastNotifyAt < MIN_INTERVAL_MS) return;
                if (!looksLikeScreenshot(uri)) return;
                lastNotifyAt = now;
                JSObject data = new JSObject();
                data.put("timestamp", System.currentTimeMillis());
                notifyListeners("screenshotTaken", data);
            });
        } catch (RejectedExecutionException ignored) {
        }
    }

    private boolean looksLikeScreenshot(Uri uri) {
        Cursor cursor = null;
        try {
            boolean useRelative = Build.VERSION.SDK_INT >= 29;
            String[] projection = useRelative
                    ? new String[]{ MediaStore.MediaColumns.RELATIVE_PATH, MediaStore.MediaColumns.DATA }
                    : new String[]{ MediaStore.MediaColumns.DATA };
            cursor = getContext().getApplicationContext().getContentResolver()
                    .query(uri, projection, null, null, null);
            if (cursor == null || !cursor.moveToFirst()) return false;
            String relative = useRelative ? cursor.getString(0) : null;
            String data = cursor.getString(useRelative ? 1 : 0);
            return containsIgnoreCase(relative, "screenshot") || containsIgnoreCase(data, "screenshot");
        } catch (Exception e) {
            Log.w(TAG, "query failed", e);
            return false;
        } finally {
            if (cursor != null) cursor.close();
        }
    }

    private static boolean containsIgnoreCase(String s, String needle) {
        return s != null && s.toLowerCase().contains(needle);
    }

    @PluginMethod
    public void check(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("granted", getPermissionState("readMedia") == PermissionState.GRANTED
                || getPermissionState("readStorage") == PermissionState.GRANTED);
        call.resolve(ret);
    }

    @Override
    protected void handleOnDestroy() {
        if (observer != null) {
            getContext().getApplicationContext().getContentResolver().unregisterContentObserver(observer);
            observer = null;
        }
        executor.shutdownNow();
    }
}
