package com.questionbank.local;

import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Color;
import android.graphics.Matrix;
import android.graphics.Rect;
import android.graphics.RectF;
import android.media.Image;
import android.os.Bundle;
import android.util.Size;
import android.widget.Button;
import android.widget.TextView;
import android.widget.Toast;
import androidx.annotation.NonNull;
import androidx.appcompat.app.AppCompatActivity;
import androidx.camera.core.Camera;
import androidx.camera.core.CameraSelector;
import androidx.camera.core.FocusMeteringAction;
import androidx.camera.core.ImageAnalysis;
import androidx.camera.core.ImageCapture;
import androidx.camera.core.ImageCaptureException;
import androidx.camera.core.ImageProxy;
import androidx.camera.core.MeteringPoint;
import androidx.camera.core.Preview;
import androidx.camera.lifecycle.ProcessCameraProvider;
import androidx.camera.view.PreviewView;
import androidx.core.content.ContextCompat;
import androidx.exifinterface.media.ExifInterface;
import com.google.android.gms.tasks.Tasks;
import com.google.common.util.concurrent.ListenableFuture;
import com.google.mlkit.vision.common.InputImage;
import com.google.mlkit.vision.text.Text;
import com.google.mlkit.vision.text.TextRecognition;
import com.google.mlkit.vision.text.TextRecognizer;
import com.google.mlkit.vision.text.chinese.ChineseTextRecognizerOptions;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.List;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

public class SmartCaptureActivity extends AppCompatActivity {
    public static final String EXTRA_FILE_PATH = "smart_capture_file_path";
    public static final String EXTRA_IMAGE_WIDTH = "smart_capture_image_width";
    public static final String EXTRA_IMAGE_HEIGHT = "smart_capture_image_height";
    public static final String EXTRA_RECT_LEFT = "smart_capture_rect_left";
    public static final String EXTRA_RECT_TOP = "smart_capture_rect_top";
    public static final String EXTRA_RECT_WIDTH = "smart_capture_rect_width";
    public static final String EXTRA_RECT_HEIGHT = "smart_capture_rect_height";

    private PreviewView previewView;
    private DetectionOverlayView overlayView;
    private TextView hintView;
    private Button shootButton;
    private ProcessCameraProvider cameraProvider;
    private ImageCapture imageCapture;
    private ImageAnalysis imageAnalysis;
    private Camera camera;
    private ExecutorService cameraExecutor;
    private TextRecognizer recognizer;
    private boolean detectorBusy = false;
    private boolean captureBusy = false;
    private RectF stableRect;
    private RectF stableRectNormalized;
    private int stableFrames = 0;
    private int missFrames = 0;
    private int analysisWidth = 0;
    private int analysisHeight = 0;
    private long lastFocusAt = 0L;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_smart_capture);
        previewView = findViewById(R.id.smart_capture_preview);
        overlayView = findViewById(R.id.smart_capture_overlay);
        hintView = findViewById(R.id.smart_capture_hint);
        shootButton = findViewById(R.id.smart_capture_shoot);
        Button closeButton = findViewById(R.id.smart_capture_close);
        cameraExecutor = Executors.newSingleThreadExecutor();
        recognizer = TextRecognition.getClient(new ChineseTextRecognizerOptions.Builder().build());
        closeButton.setOnClickListener(v -> cancelCapture());
        shootButton.setOnClickListener(v -> capturePhoto());
        previewView.post(this::startCamera);
    }

    private void startCamera() {
        ListenableFuture<ProcessCameraProvider> future = ProcessCameraProvider.getInstance(this);
        future.addListener(() -> {
            try {
                cameraProvider = future.get();
                bindCameraUseCases();
            } catch (ExecutionException | InterruptedException e) {
                showError("无法打开相机");
            }
        }, ContextCompat.getMainExecutor(this));
    }

    private void bindCameraUseCases() {
        if (cameraProvider == null) return;
        cameraProvider.unbindAll();
        Preview preview = new Preview.Builder().build();
        preview.setSurfaceProvider(previewView.getSurfaceProvider());
        imageCapture =
            new ImageCapture.Builder().setCaptureMode(ImageCapture.CAPTURE_MODE_MINIMIZE_LATENCY).build();
        imageAnalysis =
            new ImageAnalysis.Builder()
                .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                .setTargetResolution(new Size(1280, 720))
                .build();
        imageAnalysis.setAnalyzer(cameraExecutor, this::analyzeImage);
        CameraSelector selector = CameraSelector.DEFAULT_BACK_CAMERA;
        camera = cameraProvider.bindToLifecycle(this, selector, preview, imageCapture, imageAnalysis);
    }

    private void analyzeImage(ImageProxy imageProxy) {
        if (captureBusy || detectorBusy) {
            imageProxy.close();
            return;
        }
        Image mediaImage = imageProxy.getImage();
        if (mediaImage == null) {
            imageProxy.close();
            return;
        }
        detectorBusy = true;
        int rotation = imageProxy.getImageInfo().getRotationDegrees();
        int width = rotation % 180 == 0 ? imageProxy.getWidth() : imageProxy.getHeight();
        int height = rotation % 180 == 0 ? imageProxy.getHeight() : imageProxy.getWidth();
        InputImage image = InputImage.fromMediaImage(mediaImage, rotation);
        recognizer
            .process(image)
            .addOnSuccessListener(text -> {
                analysisWidth = width;
                analysisHeight = height;
                RectF candidate = detectQuestionRect(text, width, height);
                handlePreviewCandidate(candidate);
            })
            .addOnFailureListener(e -> handlePreviewCandidate(null))
            .addOnCompleteListener(task -> {
                detectorBusy = false;
                imageProxy.close();
            });
    }

    private void handlePreviewCandidate(RectF candidate) {
        runOnUiThread(() -> {
            if (candidate == null) {
                missFrames++;
                if (missFrames >= 4) {
                    stableRect = null;
                    stableRectNormalized = null;
                    stableFrames = 0;
                    overlayView.setLocked(false);
                    hintView.setText("把题目放在画面中间");
                }
                return;
            }
            missFrames = 0;
            if (stableRect != null && iou(stableRect, candidate) > 0.42f) {
                stableRect = blendRect(stableRect, candidate, 0.32f);
                stableFrames++;
            } else {
                stableRect = new RectF(candidate);
                stableFrames = 1;
            }
            stableRectNormalized =
                new RectF(
                    stableRect.left / analysisWidth,
                    stableRect.top / analysisHeight,
                    stableRect.right / analysisWidth,
                    stableRect.bottom / analysisHeight
                );
            overlayView.setLocked(stableFrames >= 2);
            hintView.setText(stableFrames >= 2 ? "已锁定中间题目，点击拍照" : "把题目放在中心框内");
            maybeFocus();
        });
    }

    private void maybeFocus() {
        if (camera == null || stableFrames < 2 || stableRectNormalized == null) return;
        long now = System.currentTimeMillis();
        if (now - lastFocusAt < 1200) return;
        float size = Math.max(stableRectNormalized.width(), stableRectNormalized.height());
        size = clamp(size * 0.9f, 0.18f, 0.42f);
        MeteringPoint point =
            previewView
                .getMeteringPointFactory()
                .createPoint(stableRectNormalized.centerX(), stableRectNormalized.centerY(), size);
        FocusMeteringAction action =
            new FocusMeteringAction.Builder(point).setAutoCancelDuration(2, TimeUnit.SECONDS).build();
        camera.getCameraControl().startFocusAndMetering(action);
        lastFocusAt = now;
    }

    private void capturePhoto() {
        if (imageCapture == null || captureBusy) return;
        captureBusy = true;
        shootButton.setEnabled(false);
        hintView.setText("正在拍照...");
        File outputFile;
        try {
            outputFile = File.createTempFile("smart_capture_", ".jpg", getCacheDir());
        } catch (IOException e) {
            captureBusy = false;
            shootButton.setEnabled(true);
            showError("创建图片失败");
            return;
        }
        ImageCapture.OutputFileOptions outputOptions = new ImageCapture.OutputFileOptions.Builder(outputFile).build();
        imageCapture.takePicture(
            outputOptions,
            ContextCompat.getMainExecutor(this),
            new ImageCapture.OnImageSavedCallback() {
                @Override
                public void onImageSaved(@NonNull ImageCapture.OutputFileResults outputFileResults) {
                    cameraExecutor.execute(() -> processCapturedFile(outputFile));
                }

                @Override
                public void onError(@NonNull ImageCaptureException exception) {
                    runOnUiThread(() -> {
                        captureBusy = false;
                        shootButton.setEnabled(true);
                        hintView.setText("把题目放在画面中间");
                        showError("拍照失败");
                    });
                }
            }
        );
    }

    private void processCapturedFile(File outputFile) {
        try {
            Bitmap bitmap = decodeBitmap(outputFile.getAbsolutePath(), 2400);
            if (bitmap == null) throw new IOException("bitmap decode failed");
            Bitmap uprightBitmap = applyExifRotation(outputFile.getAbsolutePath(), bitmap);
            if (uprightBitmap != bitmap) bitmap.recycle();
            writeBitmap(outputFile, uprightBitmap);
            RectF cropRect = detectQuestionRect(uprightBitmap);
            if (cropRect == null && stableRectNormalized != null) {
                cropRect =
                    new RectF(
                        stableRectNormalized.left * uprightBitmap.getWidth(),
                        stableRectNormalized.top * uprightBitmap.getHeight(),
                        stableRectNormalized.right * uprightBitmap.getWidth(),
                        stableRectNormalized.bottom * uprightBitmap.getHeight()
                    );
            }
            Rect finalRect = toIntRect(cropRect, uprightBitmap.getWidth(), uprightBitmap.getHeight());
            int width = uprightBitmap.getWidth();
            int height = uprightBitmap.getHeight();
            uprightBitmap.recycle();
            runOnUiThread(() -> finishWithResult(outputFile, width, height, finalRect));
        } catch (Exception e) {
            runOnUiThread(() -> {
                captureBusy = false;
                shootButton.setEnabled(true);
                hintView.setText("把题目放在画面中间");
                showError("处理图片失败");
            });
        }
    }

    private void finishWithResult(File file, int width, int height, Rect rect) {
        Intent intent = new Intent();
        intent.putExtra(EXTRA_FILE_PATH, file.getAbsolutePath());
        intent.putExtra(EXTRA_IMAGE_WIDTH, width);
        intent.putExtra(EXTRA_IMAGE_HEIGHT, height);
        if (rect != null) {
            intent.putExtra(EXTRA_RECT_LEFT, rect.left);
            intent.putExtra(EXTRA_RECT_TOP, rect.top);
            intent.putExtra(EXTRA_RECT_WIDTH, rect.width());
            intent.putExtra(EXTRA_RECT_HEIGHT, rect.height());
        }
        setResult(RESULT_OK, intent);
        finish();
    }

    private void cancelCapture() {
        setResult(RESULT_CANCELED);
        finish();
    }

    private RectF detectQuestionRect(Bitmap bitmap) throws Exception {
        InputImage image = InputImage.fromBitmap(bitmap, 0);
        Text text = Tasks.await(recognizer.process(image));
        List<Rect> lines = collectLineRects(text);
        if (lines.isEmpty()) return detectDiagramOnlyRect(bitmap);
        RectF roughRect = detectQuestionRect(lines, bitmap.getWidth(), bitmap.getHeight());
        if (roughRect == null) return null;
        return refineQuestionRect(bitmap, lines, roughRect);
    }

    private RectF detectQuestionRect(Text text, int imageWidth, int imageHeight) {
        List<Rect> lines = collectLineRects(text);
        if (lines.isEmpty()) return null;
        return detectQuestionRect(lines, imageWidth, imageHeight);
    }

    private List<Rect> collectLineRects(Text text) {
        List<Rect> lines = new ArrayList<>();
        for (Text.TextBlock block : text.getTextBlocks()) {
            for (Text.Line line : block.getLines()) {
                Rect box = line.getBoundingBox();
                if (box != null && box.width() > 0 && box.height() > 0) lines.add(new Rect(box));
            }
        }
        if (!lines.isEmpty()) return lines;
        for (Text.TextBlock block : text.getTextBlocks()) {
            Rect box = block.getBoundingBox();
            if (box != null && box.width() > 0 && box.height() > 0) lines.add(new Rect(box));
        }
        return lines;
    }

    private RectF detectQuestionRect(List<Rect> lines, int imageWidth, int imageHeight) {
        Collections.sort(lines, Comparator.comparingInt(a -> a.top));
        List<CandidateGroup> groups = new ArrayList<>();
        for (Rect line : lines) {
            CandidateGroup bestGroup = null;
            float bestMatch = 0f;
            for (CandidateGroup group : groups) {
                float gap = line.top - group.bounds.bottom;
                float overlapX = overlapRatioX(line, group.bounds);
                float centerDiff = Math.abs(centerX(line) - group.centerX()) / imageWidth;
                float leftDiff = Math.abs(line.left - group.averageLeft) / imageWidth;
                boolean closeVertically = gap <= Math.max(group.averageHeight * 1.18f, imageHeight * 0.015f);
                boolean canBridge = overlapX >= 0.32f && gap <= Math.max(group.averageHeight * 1.55f, imageHeight * 0.02f);
                float match = overlapX * 0.68f + Math.max(0f, 1f - centerDiff / 0.24f) * 0.22f + Math.max(0f, 1f - leftDiff / 0.18f) * 0.1f;
                if ((closeVertically || canBridge) && match > bestMatch && match > 0.26f) {
                    bestGroup = group;
                    bestMatch = match;
                }
            }
            if (bestGroup == null) groups.add(new CandidateGroup(line));
            else bestGroup.add(line);
        }
        RectF bestRect = null;
        float bestScore = Float.NEGATIVE_INFINITY;
        for (CandidateGroup group : groups) {
            RectF rect = group.toRect(imageWidth, imageHeight);
            float widthRatio = rect.width() / imageWidth;
            float heightRatio = rect.height() / imageHeight;
            float areaRatio = (rect.width() * rect.height()) / (imageWidth * imageHeight);
            if (widthRatio < 0.18f || heightRatio < 0.045f || areaRatio > 0.78f) continue;
            float dx = Math.abs(rect.centerX() - imageWidth / 2f) / (imageWidth / 2f);
            float dy = Math.abs(rect.centerY() - imageHeight / 2f) / (imageHeight / 2f);
            float centerScore = 1f - Math.min(1f, dx * 0.75f + dy * 1.25f);
            float areaScore = 1f - Math.min(1f, Math.abs(areaRatio - 0.16f) / 0.16f);
            float widthScore = 1f - Math.min(1f, Math.abs(widthRatio - 0.52f) / 0.52f);
            float lineScore = Math.min(1f, group.count / 5f);
            float containsCenter = rect.contains(imageWidth / 2f, imageHeight / 2f) ? 0.18f : 0f;
            float score = centerScore * 0.5f + areaScore * 0.18f + widthScore * 0.14f + lineScore * 0.18f + containsCenter;
            if (score > bestScore) {
                bestScore = score;
                bestRect = rect;
            }
        }
        return bestRect;
    }

    private RectF refineQuestionRect(Bitmap bitmap, List<Rect> lines, RectF roughRect) {
        ProjectionData projection = buildProjection(bitmap);
        if (projection == null) return roughRect;
        RectF scaledRough = projection.scaleRect(roughRect);
        int centerY = Math.round(scaledRough.centerY());
        int xStart = Math.max(0, Math.round(scaledRough.left - projection.width * 0.05f));
        int xEnd = Math.min(projection.width - 1, Math.round(scaledRough.right + projection.width * 0.05f));
        if (xEnd <= xStart) {
            xStart = Math.round(projection.width * 0.08f);
            xEnd = Math.round(projection.width * 0.92f);
        }
        int[] rowInk = buildRowInk(projection.gray, projection.width, projection.height, xStart, xEnd, projection.threshold);
        float[] rowSmooth = smoothSeries(rowInk, Math.max(3, projection.height / 180));
        float rowPeak = maxValue(rowSmooth);
        float rowBlankThreshold = Math.max((xEnd - xStart + 1) * 0.012f, rowPeak * 0.1f);
        int minBlankRows = Math.max(12, Math.round(projection.height * 0.012f));
        int top = findTopBoundary(rowSmooth, Math.round(scaledRough.top), centerY, rowBlankThreshold, minBlankRows);
        int bottom = findBottomBoundary(rowSmooth, Math.round(scaledRough.bottom), centerY, rowBlankThreshold, minBlankRows, projection.height);
        if (bottom <= top) {
            top = Math.max(0, Math.round(scaledRough.top));
            bottom = Math.min(projection.height - 1, Math.round(scaledRough.bottom));
        }
        List<Rect> bandLines = new ArrayList<>();
        float scaleY = (float) projection.height / bitmap.getHeight();
        for (Rect line : lines) {
            int scaledTop = Math.round(line.top * scaleY);
            int scaledBottom = Math.round(line.bottom * scaleY);
            if (scaledBottom >= top && scaledTop <= bottom) bandLines.add(line);
        }
        if (bandLines.isEmpty()) return roughRect;
        RectF bandRect = unionRect(bandLines);
        List<Rect> regionRects = new ArrayList<>(bandLines);
        RectF scaledBandRect = projection.scaleRect(bandRect);
        int xBandStart = Math.max(0, Math.round(Math.min(scaledBandRect.left, scaledRough.left) - projection.width * 0.05f));
        int xBandEnd = Math.min(projection.width - 1, Math.round(Math.max(scaledBandRect.right, scaledRough.right) + projection.width * 0.05f));
        int[] colInk = buildColInk(projection.gray, projection.width, top, bottom, xBandStart, xBandEnd, projection.threshold);
        float[] colSmooth = smoothSeries(colInk, Math.max(4, projection.width / 220));
        float colPeak = maxValue(colSmooth);
        float colThreshold = Math.max((bottom - top + 1) * 0.03f, colPeak * 0.14f);
        IntRange xRange = findContentColumns(colSmooth, xBandStart, xBandEnd, colThreshold);
        if (xRange == null) xRange = new IntRange(Math.round(scaledBandRect.left), Math.round(scaledBandRect.right));
        int padX = Math.max(18, Math.round(projection.width * 0.018f));
        int padY = Math.max(12, Math.round(projection.height * 0.012f));
        RectF refinedScaled =
            new RectF(
                Math.max(0, xRange.start - padX),
                Math.max(0, top - padY),
                Math.min(projection.width, xRange.end + padX),
                Math.min(projection.height, bottom + padY)
            );
        RectF refined = projection.unscaleRect(refinedScaled);
        List<Rect> imageRegions = detectImageRegions(bitmap, refined, bandLines);
        regionRects.addAll(imageRegions);
        RectF ocrRect = unionRect(regionRects);
        float left = Math.min(refined.left, ocrRect.left - bitmap.getWidth() * 0.01f);
        float right = Math.max(refined.right, ocrRect.right + bitmap.getWidth() * 0.01f);
        float topFinal = Math.min(refined.top, ocrRect.top - bitmap.getHeight() * 0.008f);
        float bottomFinal = Math.max(refined.bottom, ocrRect.bottom + bitmap.getHeight() * 0.008f);
        return new RectF(
            Math.max(0, left),
            Math.max(0, topFinal),
            Math.min(bitmap.getWidth(), right),
            Math.min(bitmap.getHeight(), bottomFinal)
        );
    }

    private RectF detectDiagramOnlyRect(Bitmap bitmap) {
        List<Rect> regions = detectImageRegions(bitmap, new RectF(0, 0, bitmap.getWidth(), bitmap.getHeight()), Collections.emptyList());
        if (regions.isEmpty()) return null;
        return unionRect(regions);
    }

    private RectF mapImageRectToPreview(RectF rect, int imageWidth, int imageHeight) {
        float viewWidth = previewView.getWidth();
        float viewHeight = previewView.getHeight();
        float scale = Math.max(viewWidth / imageWidth, viewHeight / imageHeight);
        float dx = (viewWidth - imageWidth * scale) / 2f;
        float dy = (viewHeight - imageHeight * scale) / 2f;
        return new RectF(
            dx + rect.left * scale,
            dy + rect.top * scale,
            dx + rect.right * scale,
            dy + rect.bottom * scale
        );
    }

    private RectF blendRect(RectF a, RectF b, float ratio) {
        return new RectF(
            a.left + (b.left - a.left) * ratio,
            a.top + (b.top - a.top) * ratio,
            a.right + (b.right - a.right) * ratio,
            a.bottom + (b.bottom - a.bottom) * ratio
        );
    }

    private float iou(RectF a, RectF b) {
        float left = Math.max(a.left, b.left);
        float top = Math.max(a.top, b.top);
        float right = Math.min(a.right, b.right);
        float bottom = Math.min(a.bottom, b.bottom);
        if (right <= left || bottom <= top) return 0f;
        float intersection = (right - left) * (bottom - top);
        float union = a.width() * a.height() + b.width() * b.height() - intersection;
        return union <= 0 ? 0f : intersection / union;
    }

    private float overlapRatioX(Rect line, Rect bounds) {
        int left = Math.max(line.left, bounds.left);
        int right = Math.min(line.right, bounds.right);
        if (right <= left) return 0f;
        return (float) (right - left) / Math.max(1f, Math.min(line.width(), bounds.width()));
    }

    private float centerX(Rect rect) {
        return rect.left + rect.width() / 2f;
    }

    private RectF unionRect(List<Rect> rects) {
        RectF result = null;
        for (Rect rect : rects) {
            if (result == null) result = new RectF(rect);
            else result.union(rect.left, rect.top, rect.right, rect.bottom);
        }
        return result;
    }

    private ProjectionData buildProjection(Bitmap bitmap) {
        int srcWidth = bitmap.getWidth();
        int srcHeight = bitmap.getHeight();
        if (srcWidth <= 0 || srcHeight <= 0) return null;
        int maxDimension = 1600;
        float scale = Math.min(1f, maxDimension / (float) Math.max(srcWidth, srcHeight));
        int width = Math.max(240, Math.round(srcWidth * scale));
        int height = Math.max(240, Math.round(srcHeight * scale));
        Bitmap scaled = bitmap;
        if (width != srcWidth || height != srcHeight) scaled = Bitmap.createScaledBitmap(bitmap, width, height, true);
        int[] pixels = new int[width * height];
        scaled.getPixels(pixels, 0, width, 0, 0, width, height);
        int[] histogram = new int[256];
        byte[] gray = new byte[width * height];
        long total = 0;
        for (int i = 0; i < pixels.length; i++) {
            int color = pixels[i];
            int value =
                (int) Math.round(((color >> 16) & 0xFF) * 0.299 + ((color >> 8) & 0xFF) * 0.587 + (color & 0xFF) * 0.114);
            gray[i] = (byte) value;
            histogram[value]++;
            total += value;
        }
        int threshold = Math.min(getOtsuThreshold(histogram, gray.length), (int) Math.round(total / (double) gray.length) - 10);
        threshold = Math.max(80, Math.min(210, threshold));
        return new ProjectionData(gray, width, height, threshold, srcWidth, srcHeight);
    }

    private List<Rect> detectImageRegions(Bitmap bitmap, RectF focusRect, List<Rect> textLines) {
        int srcWidth = bitmap.getWidth();
        int srcHeight = bitmap.getHeight();
        int maxDimension = 1400;
        float scale = Math.min(1f, maxDimension / (float) Math.max(srcWidth, srcHeight));
        int width = Math.max(240, Math.round(srcWidth * scale));
        int height = Math.max(240, Math.round(srcHeight * scale));
        Bitmap scaled = bitmap;
        if (width != srcWidth || height != srcHeight) scaled = Bitmap.createScaledBitmap(bitmap, width, height, true);
        int[] pixels = new int[width * height];
        scaled.getPixels(pixels, 0, width, 0, 0, width, height);
        RectF scaledFocus =
            new RectF(
                focusRect.left * width / srcWidth,
                focusRect.top * height / srcHeight,
                focusRect.right * width / srcWidth,
                focusRect.bottom * height / srcHeight
            );
        boolean[] blocked = new boolean[width * height];
        for (Rect line : textLines) {
            int left = Math.max(0, Math.round(line.left * width / (float) srcWidth));
            int top = Math.max(0, Math.round(line.top * height / (float) srcHeight));
            int right = Math.min(width - 1, Math.round(line.right * width / (float) srcWidth));
            int bottom = Math.min(height - 1, Math.round(line.bottom * height / (float) srcHeight));
            for (int y = top; y <= bottom; y++) {
                int offset = y * width;
                for (int x = left; x <= right; x++) blocked[offset + x] = true;
            }
        }
        boolean[] visited = new boolean[width * height];
        int[] queue = new int[width * height];
        List<Rect> regions = new ArrayList<>();
        int minArea = Math.max(180, Math.round(width * height * 0.00022f));
        int minSide = Math.max(14, Math.round(Math.min(width, height) * 0.02f));
        for (int y = Math.max(0, (int) scaledFocus.top - height / 25); y < Math.min(height, (int) scaledFocus.bottom + height / 25); y++) {
            for (int x = Math.max(0, (int) scaledFocus.left - width / 25); x < Math.min(width, (int) scaledFocus.right + width / 25); x++) {
                int index = y * width + x;
                if (visited[index] || blocked[index]) continue;
                int color = pixels[index];
                if (!isDarkOrColored(color)) continue;
                int head = 0;
                int tail = 0;
                queue[tail++] = index;
                visited[index] = true;
                int minX = x;
                int minY = y;
                int maxX = x;
                int maxY = y;
                int count = 0;
                while (head < tail) {
                    int current = queue[head++];
                    int cx = current % width;
                    int cy = current / width;
                    count++;
                    if (cx < minX) minX = cx;
                    if (cy < minY) minY = cy;
                    if (cx > maxX) maxX = cx;
                    if (cy > maxY) maxY = cy;
                    for (int ny = Math.max(0, cy - 1); ny <= Math.min(height - 1, cy + 1); ny++) {
                        int rowOffset = ny * width;
                        for (int nx = Math.max(0, cx - 1); nx <= Math.min(width - 1, cx + 1); nx++) {
                            int next = rowOffset + nx;
                            if (visited[next] || blocked[next]) continue;
                            if (!isDarkOrColored(pixels[next])) continue;
                            visited[next] = true;
                            queue[tail++] = next;
                        }
                    }
                }
                int regionWidth = maxX - minX + 1;
                int regionHeight = maxY - minY + 1;
                if (count < minArea || regionWidth < minSide || regionHeight < minSide) continue;
                if (regionWidth > width * 0.85f || regionHeight > height * 0.45f) continue;
                Rect rect =
                    new Rect(
                        Math.max(0, Math.round(minX * srcWidth / (float) width)),
                        Math.max(0, Math.round(minY * srcHeight / (float) height)),
                        Math.min(srcWidth, Math.round((maxX + 1) * srcWidth / (float) width)),
                        Math.min(srcHeight, Math.round((maxY + 1) * srcHeight / (float) height))
                    );
                regions.add(rect);
            }
        }
        return mergeNearbyRegions(regions, srcWidth, srcHeight);
    }

    private boolean isDarkOrColored(int color) {
        int r = Color.red(color);
        int g = Color.green(color);
        int b = Color.blue(color);
        int max = Math.max(r, Math.max(g, b));
        int min = Math.min(r, Math.min(g, b));
        int gray = (int) Math.round(r * 0.299 + g * 0.587 + b * 0.114);
        return gray < 195 || (max - min) > 28;
    }

    private List<Rect> mergeNearbyRegions(List<Rect> rects, int imageWidth, int imageHeight) {
        List<Rect> merged = new ArrayList<>();
        for (Rect rect : rects) {
            Rect candidate = new Rect(rect);
            boolean changed = true;
            while (changed) {
                changed = false;
                for (int i = merged.size() - 1; i >= 0; i--) {
                    Rect existing = merged.get(i);
                    if (canMergeRegion(existing, candidate, imageWidth, imageHeight)) {
                        candidate.union(existing);
                        merged.remove(i);
                        changed = true;
                    }
                }
            }
            merged.add(candidate);
        }
        return merged;
    }

    private boolean canMergeRegion(Rect a, Rect b, int imageWidth, int imageHeight) {
        int gapX = Math.max(0, Math.max(a.left, b.left) - Math.min(a.right, b.right));
        int gapY = Math.max(0, Math.max(a.top, b.top) - Math.min(a.bottom, b.bottom));
        return gapX <= Math.max(18, imageWidth / 70) && gapY <= Math.max(18, imageHeight / 70);
    }

    private int[] buildRowInk(byte[] gray, int width, int height, int xStart, int xEnd, int threshold) {
        int[] rows = new int[height];
        for (int y = 0; y < height; y++) {
            int count = 0;
            int offset = y * width;
            for (int x = xStart; x <= xEnd; x++) {
                if ((gray[offset + x] & 0xFF) < threshold) count++;
            }
            rows[y] = count;
        }
        return rows;
    }

    private int[] buildColInk(byte[] gray, int width, int yStart, int yEnd, int xStart, int xEnd, int threshold) {
        int[] cols = new int[width];
        for (int x = xStart; x <= xEnd; x++) {
            int count = 0;
            for (int y = yStart; y <= yEnd; y++) {
                if ((gray[y * width + x] & 0xFF) < threshold) count++;
            }
            cols[x] = count;
        }
        return cols;
    }

    private float[] smoothSeries(int[] values, int radius) {
        if (values.length == 0 || radius <= 0) {
            float[] copy = new float[values.length];
            for (int i = 0; i < values.length; i++) copy[i] = values[i];
            return copy;
        }
        float[] prefix = new float[values.length + 1];
        for (int i = 0; i < values.length; i++) prefix[i + 1] = prefix[i] + values[i];
        float[] out = new float[values.length];
        for (int i = 0; i < values.length; i++) {
            int start = Math.max(0, i - radius);
            int end = Math.min(values.length - 1, i + radius);
            out[i] = (prefix[end + 1] - prefix[start]) / (end - start + 1);
        }
        return out;
    }

    private float maxValue(float[] values) {
        float max = 0f;
        for (float value : values) {
            if (value > max) max = value;
        }
        return max;
    }

    private int getOtsuThreshold(int[] histogram, int totalPixels) {
        long total = 0;
        for (int i = 0; i < histogram.length; i++) total += (long) i * histogram[i];
        long backgroundWeight = 0;
        long backgroundSum = 0;
        double bestVariance = -1d;
        int threshold = 180;
        for (int i = 0; i < histogram.length; i++) {
            backgroundWeight += histogram[i];
            if (backgroundWeight == 0) continue;
            long foregroundWeight = totalPixels - backgroundWeight;
            if (foregroundWeight == 0) break;
            backgroundSum += (long) i * histogram[i];
            double backgroundMean = backgroundSum / (double) backgroundWeight;
            double foregroundMean = (total - backgroundSum) / (double) foregroundWeight;
            double variance = backgroundWeight * foregroundWeight * Math.pow(backgroundMean - foregroundMean, 2);
            if (variance > bestVariance) {
                bestVariance = variance;
                threshold = i;
            }
        }
        return threshold;
    }

    private int findTopBoundary(float[] rows, int roughTop, int centerY, float blankThreshold, int minBlankRows) {
        IntRange internal = findBlankRunDownward(rows, Math.max(0, roughTop - minBlankRows), Math.max(0, centerY - minBlankRows), blankThreshold, minBlankRows);
        if (internal != null) return Math.min(rows.length - 1, internal.end + 1);
        IntRange outer = findBlankRunUpward(rows, Math.max(0, roughTop), blankThreshold, minBlankRows);
        return outer != null ? Math.min(rows.length - 1, outer.end + 1) : Math.max(0, roughTop);
    }

    private int findBottomBoundary(float[] rows, int roughBottom, int centerY, float blankThreshold, int minBlankRows, int height) {
        IntRange internal = findBlankRunUpward(rows, Math.min(height - 1, roughBottom + minBlankRows), Math.max(centerY + minBlankRows, 0), blankThreshold, minBlankRows);
        if (internal != null) return Math.max(0, internal.start - 1);
        IntRange outer = findBlankRunDownward(rows, Math.min(height - 1, roughBottom), height - 1, blankThreshold, minBlankRows);
        return outer != null ? Math.max(0, outer.start - 1) : Math.min(height - 1, roughBottom);
    }

    private IntRange findBlankRunDownward(float[] rows, int from, int to, float threshold, int minLen) {
        int runStart = -1;
        for (int i = Math.max(0, from); i <= Math.min(rows.length - 1, to); i++) {
            if (rows[i] <= threshold) {
                if (runStart == -1) runStart = i;
            } else if (runStart != -1) {
                if (i - runStart >= minLen) return new IntRange(runStart, i - 1);
                runStart = -1;
            }
        }
        if (runStart != -1 && Math.min(rows.length - 1, to) - runStart + 1 >= minLen) return new IntRange(runStart, Math.min(rows.length - 1, to));
        return null;
    }

    private IntRange findBlankRunUpward(float[] rows, int from, float threshold, int minLen) {
        return findBlankRunUpward(rows, from, 0, threshold, minLen);
    }

    private IntRange findBlankRunUpward(float[] rows, int from, int to, float threshold, int minLen) {
        int runEnd = -1;
        for (int i = Math.min(rows.length - 1, from); i >= Math.max(0, to); i--) {
            if (rows[i] <= threshold) {
                if (runEnd == -1) runEnd = i;
            } else if (runEnd != -1) {
                if (runEnd - i >= minLen) return new IntRange(i + 1, runEnd);
                runEnd = -1;
            }
        }
        if (runEnd != -1 && runEnd - Math.max(0, to) + 1 >= minLen) return new IntRange(Math.max(0, to), runEnd);
        return null;
    }

    private IntRange findContentColumns(float[] cols, int xStart, int xEnd, float threshold) {
        int left = -1;
        int right = -1;
        for (int x = Math.max(0, xStart); x <= Math.min(cols.length - 1, xEnd); x++) {
            if (cols[x] >= threshold) {
                left = x;
                break;
            }
        }
        for (int x = Math.min(cols.length - 1, xEnd); x >= Math.max(0, xStart); x--) {
            if (cols[x] >= threshold) {
                right = x;
                break;
            }
        }
        if (left == -1 || right == -1 || right <= left) return null;
        return new IntRange(left, right);
    }

    private Rect toIntRect(RectF rect, int maxWidth, int maxHeight) {
        if (rect == null) return null;
        int left = Math.max(0, Math.round(rect.left));
        int top = Math.max(0, Math.round(rect.top));
        int right = Math.min(maxWidth, Math.round(rect.right));
        int bottom = Math.min(maxHeight, Math.round(rect.bottom));
        if (right <= left || bottom <= top) return null;
        return new Rect(left, top, right, bottom);
    }

    private Bitmap decodeBitmap(String path, int maxDimension) {
        BitmapFactory.Options bounds = new BitmapFactory.Options();
        bounds.inJustDecodeBounds = true;
        BitmapFactory.decodeFile(path, bounds);
        int sampleSize = 1;
        int maxSize = Math.max(bounds.outWidth, bounds.outHeight);
        while (maxSize / sampleSize > maxDimension) sampleSize *= 2;
        BitmapFactory.Options options = new BitmapFactory.Options();
        options.inSampleSize = sampleSize;
        options.inPreferredConfig = Bitmap.Config.ARGB_8888;
        return BitmapFactory.decodeFile(path, options);
    }

    private Bitmap applyExifRotation(String path, Bitmap bitmap) throws IOException {
        ExifInterface exif = new ExifInterface(path);
        int orientation = exif.getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL);
        Matrix matrix = new Matrix();
        if (orientation == ExifInterface.ORIENTATION_ROTATE_90) matrix.postRotate(90f);
        else if (orientation == ExifInterface.ORIENTATION_ROTATE_180) matrix.postRotate(180f);
        else if (orientation == ExifInterface.ORIENTATION_ROTATE_270) matrix.postRotate(270f);
        else return bitmap;
        return Bitmap.createBitmap(bitmap, 0, 0, bitmap.getWidth(), bitmap.getHeight(), matrix, true);
    }

    private void writeBitmap(File file, Bitmap bitmap) throws IOException {
        try (FileOutputStream out = new FileOutputStream(file, false)) {
            bitmap.compress(Bitmap.CompressFormat.JPEG, 90, out);
            out.flush();
        }
    }

    private void showError(String message) {
        Toast.makeText(this, message, Toast.LENGTH_SHORT).show();
    }

    private float clamp(float value, float min, float max) {
        return Math.max(min, Math.min(max, value));
    }

    @Override
    protected void onDestroy() {
        if (cameraExecutor != null) cameraExecutor.shutdown();
        if (recognizer != null) recognizer.close();
        super.onDestroy();
    }

    private static final class CandidateGroup {
        private final Rect bounds = new Rect();
        private int count = 0;
        private float averageHeight = 0f;
        private float averageLeft = 0f;

        CandidateGroup(Rect first) {
            bounds.set(first);
            count = 1;
            averageHeight = first.height();
            averageLeft = first.left;
        }

        void add(Rect rect) {
            bounds.union(rect);
            averageHeight = (averageHeight * count + rect.height()) / (count + 1);
            averageLeft = (averageLeft * count + rect.left) / (count + 1);
            count++;
        }

        float centerX() {
            return bounds.left + bounds.width() / 2f;
        }

        RectF toRect(int imageWidth, int imageHeight) {
            float padX = Math.max(imageWidth * 0.028f, averageHeight * 0.8f);
            float padY = Math.max(imageHeight * 0.015f, averageHeight * 0.5f);
            return new RectF(
                Math.max(0f, bounds.left - padX),
                Math.max(0f, bounds.top - padY),
                Math.min(imageWidth, bounds.right + padX),
                Math.min(imageHeight, bounds.bottom + padY)
            );
        }
    }

    private static final class IntRange {
        private final int start;
        private final int end;

        private IntRange(int start, int end) {
            this.start = start;
            this.end = end;
        }
    }

    private static final class ProjectionData {
        private final byte[] gray;
        private final int width;
        private final int height;
        private final int threshold;
        private final int srcWidth;
        private final int srcHeight;

        private ProjectionData(byte[] gray, int width, int height, int threshold, int srcWidth, int srcHeight) {
            this.gray = gray;
            this.width = width;
            this.height = height;
            this.threshold = threshold;
            this.srcWidth = srcWidth;
            this.srcHeight = srcHeight;
        }

        private RectF scaleRect(RectF rect) {
            return new RectF(rect.left * width / srcWidth, rect.top * height / srcHeight, rect.right * width / srcWidth, rect.bottom * height / srcHeight);
        }

        private RectF unscaleRect(RectF rect) {
            return new RectF(rect.left * srcWidth / width, rect.top * srcHeight / height, rect.right * srcWidth / width, rect.bottom * srcHeight / height);
        }
    }
}
