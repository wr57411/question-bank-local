package com.questionbank.local;

import android.Manifest;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.net.Uri;
import android.os.Build;
import android.provider.MediaStore;
import android.util.Base64;
import android.util.Log;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.File;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

@CapacitorPlugin(
    name = "MediaGallery",
    permissions = {
        @Permission(strings = { Manifest.permission.READ_MEDIA_IMAGES }, alias = "readMedia"),
        @Permission(strings = { Manifest.permission.READ_EXTERNAL_STORAGE }, alias = "readStorage")
    }
)
public class MediaGalleryPlugin extends Plugin {

    private static final String TAG = "MediaGallery";
    private static final int DEFAULT_QUANTITY = 20;
    private static final int DEFAULT_THUMB_WIDTH = 120;
    private static final int DEFAULT_THUMB_HEIGHT = 120;
    private static final int DEFAULT_THUMB_QUALITY = 80;

    private final ExecutorService executor = Executors.newSingleThreadExecutor();

    @PluginMethod
    public void getMedias(PluginCall call) {
        Log.d(TAG, "getMedias called");

        if (!hasPermission()) {
            Log.d(TAG, "Permission not granted, requesting...");
            requestAllPermissions(call, "permissionCallback");
            return;
        }

        executeGetMedias(call);
    }

    @PluginMethod
    public void getFullImage(PluginCall call) {
        Log.d(TAG, "getFullImage called");

        if (!hasPermission()) {
            Log.d(TAG, "Permission not granted, requesting...");
            requestAllPermissions(call, "fullImagePermissionCallback");
            return;
        }

        String identifier = call.getString("identifier");
        if (identifier == null || identifier.isEmpty()) {
            call.reject("Must provide an identifier", "ARG_ERROR");
            return;
        }

        final String id = identifier;
        executor.execute(() -> {
            try {
                JSObject result = doGetFullImage(id);
                call.resolve(result);
            } catch (Exception e) {
                Log.e(TAG, "getFullImage failed", e);
                call.reject("Failed to load full image: " + e.getMessage(), e);
            }
        });
    }

    @PermissionCallback
    private void fullImagePermissionCallback(PluginCall call) {
        if (hasPermission()) {
            String identifier = call.getString("identifier");
            if (identifier == null || identifier.isEmpty()) {
                call.reject("Must provide an identifier", "ARG_ERROR");
                return;
            }
            final String id = identifier;
            executor.execute(() -> {
                try {
                    JSObject result = doGetFullImage(id);
                    call.resolve(result);
                } catch (Exception e) {
                    Log.e(TAG, "getFullImage failed", e);
                    call.reject("Failed to load full image: " + e.getMessage(), e);
                }
            });
        } else {
            call.reject("Permission denied", "PERMISSION_DENIED");
        }
    }

    private JSObject doGetFullImage(String identifier) throws Exception {
        Log.d(TAG, "doGetFullImage: " + identifier);

        Uri uri;
        if (identifier.startsWith("content://")) {
            uri = Uri.parse(identifier);
        } else if (identifier.startsWith("file://")) {
            uri = Uri.parse(identifier);
        } else if (new File(identifier).exists()) {
            uri = Uri.fromFile(new File(identifier));
        } else {
            // Assume it's a content URI with just the ID
            uri = Uri.withAppendedPath(
                MediaStore.Images.Media.EXTERNAL_CONTENT_URI,
                identifier
            );
        }

        InputStream is = getActivity().getContentResolver().openInputStream(uri);
        if (is == null) {
            throw new Exception("Cannot open input stream for: " + identifier);
        }

        ByteArrayOutputStream baos = new ByteArrayOutputStream();
        byte[] buffer = new byte[8192];
        int bytesRead;
        while ((bytesRead = is.read(buffer)) != -1) {
            baos.write(buffer, 0, bytesRead);
        }
        is.close();

        byte[] imageData = baos.toByteArray();
        String base64 = Base64.encodeToString(imageData, Base64.NO_WRAP);

        // Determine MIME type
        String mimeType = "image/jpeg";
        if (identifier.endsWith(".png") || identifier.endsWith(".PNG")) {
            mimeType = "image/png";
        } else {
            try {
                InputStream mimeIs = getActivity().getContentResolver().openInputStream(uri);
                if (mimeIs != null) {
                    BitmapFactory.Options opts = new BitmapFactory.Options();
                    opts.inJustDecodeBounds = true;
                    BitmapFactory.decodeStream(mimeIs, null, opts);
                    if (opts.outMimeType != null) {
                        mimeType = opts.outMimeType;
                    }
                    mimeIs.close();
                }
            } catch (Exception e) {
                Log.w(TAG, "Could not determine MIME type", e);
            }
        }

        JSObject result = new JSObject();
        result.put("data", base64);
        result.put("mimeType", mimeType);
        Log.d(TAG, "doGetFullImage: returned " + imageData.length + " bytes, mime=" + mimeType);
        return result;
    }

    @PermissionCallback
    private void permissionCallback(PluginCall call) {
        if (hasPermission()) {
            Log.d(TAG, "Permission granted");
            executeGetMedias(call);
        } else {
            Log.w(TAG, "Permission denied by user");
            call.reject("Permission denied", "PERMISSION_DENIED");
        }
    }

    private boolean hasPermission() {
        if (Build.VERSION.SDK_INT >= 33) {
            return getPermissionState("readMedia") == com.getcapacitor.PermissionState.GRANTED;
        }
        return getPermissionState("readStorage") == com.getcapacitor.PermissionState.GRANTED;
    }

    private void executeGetMedias(PluginCall call) {
        int quantity = call.getInt("quantity", DEFAULT_QUANTITY);
        int thumbWidth = call.getInt("thumbnailWidth", DEFAULT_THUMB_WIDTH);
        int thumbHeight = call.getInt("thumbnailHeight", DEFAULT_THUMB_HEIGHT);
        int thumbQuality = call.getInt("thumbnailQuality", DEFAULT_THUMB_QUALITY);

        final int reqWidth = Math.max(1, thumbWidth);
        final int reqHeight = Math.max(1, thumbHeight);
        final int quality = Math.max(1, Math.min(100, thumbQuality));
        final int limit = Math.max(1, quantity);

        Log.d(TAG, "Params: quantity=" + limit + " thumb=" + reqWidth + "x" + reqHeight + " quality=" + quality);

        executor.execute(() -> {
            try {
                doGetMedias(call, limit, reqWidth, reqHeight, quality);
            } catch (Exception e) {
                Log.e(TAG, "executeGetMedias error", e);
                call.reject("Failed: " + e.getMessage(), e);
            }
        });
    }

    private void doGetMedias(PluginCall call, int limit, int reqWidth, int reqHeight, int quality) {
        JSArray medias = new JSArray();

        String[] projection = {
            MediaStore.MediaColumns._ID,
            MediaStore.MediaColumns.DATE_ADDED,
            MediaStore.MediaColumns.WIDTH,
            MediaStore.MediaColumns.HEIGHT,
            MediaStore.MediaColumns.MIME_TYPE
        };

        // DATA column is deprecated on API 29+, use content URI instead
        boolean useDataColumn = Build.VERSION.SDK_INT < 29;
        if (useDataColumn) {
            String[] projWithData = {
                MediaStore.MediaColumns._ID,
                MediaStore.MediaColumns.DATA,
                MediaStore.MediaColumns.DATE_ADDED,
                MediaStore.MediaColumns.WIDTH,
                MediaStore.MediaColumns.HEIGHT,
                MediaStore.MediaColumns.MIME_TYPE
            };
            projection = projWithData;
        }

        String sortOrder = MediaStore.MediaColumns.DATE_ADDED + " DESC";

        Cursor cursor = getActivity().getContentResolver().query(
            MediaStore.Images.Media.EXTERNAL_CONTENT_URI,
            projection,
            null,
            null,
            sortOrder
        );

        if (cursor == null) {
            Log.w(TAG, "cursor is null");
            JSObject response = new JSObject();
            response.put("medias", medias);
            call.resolve(response);
            return;
        }

        int totalCount = cursor.getCount();
        Log.d(TAG, "Total images in MediaStore: " + totalCount);

        int idCol = cursor.getColumnIndexOrThrow(MediaStore.MediaColumns._ID);
        int dataCol = useDataColumn ? cursor.getColumnIndex(MediaStore.MediaColumns.DATA) : -1;
        int dateCol = cursor.getColumnIndexOrThrow(MediaStore.MediaColumns.DATE_ADDED);
        int widthCol = cursor.getColumnIndex(MediaStore.MediaColumns.WIDTH);
        int heightCol = cursor.getColumnIndex(MediaStore.MediaColumns.HEIGHT);
        int mimeCol = cursor.getColumnIndex(MediaStore.MediaColumns.MIME_TYPE);

        int count = 0;
        int skipCount = 0;
        while (cursor.moveToNext() && count < limit) {
            long id = cursor.getLong(idCol);
            long dateAdded = cursor.getLong(dateCol);
            int fullWidth = widthCol >= 0 ? cursor.getInt(widthCol) : 0;
            int fullHeight = heightCol >= 0 ? cursor.getInt(heightCol) : 0;

            // Build content URI
            Uri contentUri = Uri.withAppendedPath(
                MediaStore.Images.Media.EXTERNAL_CONTENT_URI,
                String.valueOf(id)
            );

            // Try to get file path on older Android
            String filePath = null;
            if (useDataColumn && dataCol >= 0) {
                String path = cursor.getString(dataCol);
                if (path != null && !path.isEmpty() && new File(path).exists()) {
                    filePath = path;
                }
            }

            String identifier = (filePath != null) ? filePath : contentUri.toString();

            Log.d(TAG, "Decode thumbnail for id=" + id + " path=" + filePath + " uri=" + contentUri);

            Bitmap thumb = decodeThumbnail(contentUri, filePath, reqWidth, reqHeight);
            if (thumb == null) {
                Log.w(TAG, "Skip id=" + id + " - decode failed");
                skipCount++;
                continue;
            }

            ByteArrayOutputStream baos = new ByteArrayOutputStream();
            thumb.compress(Bitmap.CompressFormat.JPEG, quality, baos);
            String base64 = Base64.encodeToString(baos.toByteArray(), Base64.NO_WRAP);

            JSObject asset = new JSObject();
            asset.put("identifier", identifier);
            asset.put("data", base64);

            if (dateAdded > 0) {
                SimpleDateFormat sdf = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", Locale.US);
                asset.put("creationDate", sdf.format(new Date(dateAdded * 1000)));
            }

            asset.put("duration", (Double) null);
            asset.put("fullWidth", fullWidth > 0 ? fullWidth : thumb.getWidth());
            asset.put("fullHeight", fullHeight > 0 ? fullHeight : thumb.getHeight());
            asset.put("thumbnailWidth", thumb.getWidth());
            asset.put("thumbnailHeight", thumb.getHeight());

            JSObject location = new JSObject();
            location.put("latitude", 0);
            location.put("longitude", 0);
            location.put("heading", 0);
            location.put("altitude", 0);
            location.put("speed", 0);
            asset.put("location", location);

            medias.put(asset);
            count++;
            thumb.recycle();
        }

        cursor.close();

        Log.d(TAG, "Returning " + count + " medias (skipped " + skipCount + " of " + totalCount + ")");

        JSObject response = new JSObject();
        response.put("medias", medias);
        call.resolve(response);
    }

    private Bitmap decodeThumbnail(Uri contentUri, String filePath, int reqWidth, int reqHeight) {
        try {
            // Try file path first (faster)
            if (filePath != null) {
                File f = new File(filePath);
                if (f.exists()) {
                    BitmapFactory.Options bounds = new BitmapFactory.Options();
                    bounds.inJustDecodeBounds = true;
                    BitmapFactory.decodeFile(filePath, bounds);
                    if (bounds.outWidth > 0 && bounds.outHeight > 0) {
                        bounds.inSampleSize = calculateInSampleSize(bounds, reqWidth, reqHeight);
                        bounds.inJustDecodeBounds = false;
                        bounds.inPreferredConfig = Bitmap.Config.ARGB_8888;
                        Bitmap bmp = BitmapFactory.decodeFile(filePath, bounds);
                        if (bmp != null) {
                            return scaleBitmap(bmp, reqWidth, reqHeight);
                        }
                    }
                }
            }

            // Fallback: use content URI with ContentResolver
            InputStream is = getActivity().getContentResolver().openInputStream(contentUri);
            if (is == null) {
                Log.w(TAG, "Cannot open input stream for " + contentUri);
                return null;
            }

            BitmapFactory.Options bounds = new BitmapFactory.Options();
            bounds.inJustDecodeBounds = true;
            BitmapFactory.decodeStream(is, null, bounds);
            is.close();

            if (bounds.outWidth <= 0 || bounds.outHeight <= 0) {
                Log.w(TAG, "Invalid bounds: " + bounds.outWidth + "x" + bounds.outHeight);
                return null;
            }

            bounds.inSampleSize = calculateInSampleSize(bounds, reqWidth, reqHeight);
            bounds.inJustDecodeBounds = false;
            bounds.inPreferredConfig = Bitmap.Config.ARGB_8888;

            is = getActivity().getContentResolver().openInputStream(contentUri);
            if (is == null) return null;
            Bitmap bmp = BitmapFactory.decodeStream(is, null, bounds);
            is.close();

            if (bmp == null) return null;
            return scaleBitmap(bmp, reqWidth, reqHeight);
        } catch (Exception e) {
            Log.e(TAG, "decodeThumbnail failed", e);
            return null;
        }
    }

    private Bitmap scaleBitmap(Bitmap bmp, int reqWidth, int reqHeight) {
        float scale = Math.min(
            (float) reqWidth / bmp.getWidth(),
            (float) reqHeight / bmp.getHeight()
        );
        if (scale >= 1.0f) return bmp;
        int w = Math.max(1, Math.round(bmp.getWidth() * scale));
        int h = Math.max(1, Math.round(bmp.getHeight() * scale));
        Bitmap scaled = Bitmap.createScaledBitmap(bmp, w, h, true);
        if (scaled != bmp) bmp.recycle();
        return scaled;
    }

    private int calculateInSampleSize(BitmapFactory.Options options, int reqWidth, int reqHeight) {
        int height = options.outHeight;
        int width = options.outWidth;
        int inSampleSize = 1;
        if (height > reqHeight || width > reqWidth) {
            int halfH = height / 2;
            int halfW = width / 2;
            while ((halfH / inSampleSize) >= reqHeight && (halfW / inSampleSize) >= reqWidth) {
                inSampleSize *= 2;
            }
        }
        return inSampleSize;
    }
}
