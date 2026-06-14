package com.questionbank.local;

import android.content.Intent;
import android.os.Bundle;
import android.widget.Button;
import android.widget.TextView;
import android.widget.Toast;
import androidx.annotation.NonNull;
import androidx.appcompat.app.AppCompatActivity;
import androidx.camera.core.Camera;
import androidx.camera.core.CameraSelector;
import androidx.camera.core.ImageCapture;
import androidx.camera.core.ImageCaptureException;
import androidx.camera.core.Preview;
import androidx.camera.lifecycle.ProcessCameraProvider;
import androidx.camera.view.PreviewView;
import androidx.core.content.ContextCompat;
import com.google.common.util.concurrent.ListenableFuture;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.Locale;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class QuickCaptureActivity extends AppCompatActivity {
    public static final String EXTRA_PENDING_COUNT = "pending_photo_count";
    public static final String EXTRA_PENDING_PATHS = "pending_photo_paths";
    public static final String EXTRA_GROUP_INFO = "pending_group_info";

    private PreviewView previewView;
    private TextView countView;
    private Button shootButton;
    private Button doneButton;
    private Button groupButton;
    private ProcessCameraProvider cameraProvider;
    private ImageCapture imageCapture;
    private Camera camera;
    private ExecutorService cameraExecutor;
    private int photoCount = 0;
    private int groupCounter = 0;
    private String currentGroupId = "未分组";
    private File pendingDir;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_quick_capture);

        previewView = findViewById(R.id.quick_capture_preview);
        countView = findViewById(R.id.quick_capture_count);
        shootButton = findViewById(R.id.quick_capture_shoot);
        doneButton = findViewById(R.id.quick_capture_done);
        groupButton = findViewById(R.id.quick_capture_group);
        Button closeButton = findViewById(R.id.quick_capture_close);

        cameraExecutor = Executors.newSingleThreadExecutor();

        pendingDir = new File(getFilesDir(), "pending_photos");
        if (!pendingDir.exists()) pendingDir.mkdirs();

        closeButton.setOnClickListener(v -> cancelCapture());
        shootButton.setOnClickListener(v -> capturePhoto());
        doneButton.setOnClickListener(v -> finishCapture());
        groupButton.setOnClickListener(v -> createNewGroup());

        updateCount();
        previewView.post(this::startCamera);
    }

    private void startCamera() {
        ListenableFuture<ProcessCameraProvider> future = ProcessCameraProvider.getInstance(this);
        future.addListener(() -> {
            try {
                cameraProvider = future.get();
                bindCameraUseCases();
            } catch (ExecutionException | InterruptedException e) {
                Toast.makeText(this, "无法打开相机: " + e.getMessage(), Toast.LENGTH_LONG).show();
                finish();
            }
        }, ContextCompat.getMainExecutor(this));
    }

    private void bindCameraUseCases() {
        if (cameraProvider == null) return;
        cameraProvider.unbindAll();

        Preview preview = new Preview.Builder().build();
        preview.setSurfaceProvider(previewView.getSurfaceProvider());

        imageCapture = new ImageCapture.Builder()
            .setCaptureMode(ImageCapture.CAPTURE_MODE_MINIMIZE_LATENCY)
            .build();

        // 尝试后置摄像头，失败则尝试前置
        try {
            CameraSelector selector = CameraSelector.DEFAULT_BACK_CAMERA;
            camera = cameraProvider.bindToLifecycle(this, selector, preview, imageCapture);
        } catch (Exception e) {
            try {
                CameraSelector selector = CameraSelector.DEFAULT_FRONT_CAMERA;
                camera = cameraProvider.bindToLifecycle(this, selector, preview, imageCapture);
            } catch (Exception e2) {
                Toast.makeText(this, "无法访问摄像头: " + e2.getMessage(), Toast.LENGTH_LONG).show();
            }
        }
    }

    private void createNewGroup() {
        groupCounter++;
        currentGroupId = "group_" + groupCounter;
        Toast.makeText(this, "已切换到第 " + groupCounter + " 组", Toast.LENGTH_SHORT).show();
        groupButton.setText("📌 第" + groupCounter + "组");
    }

    private void capturePhoto() {
        if (imageCapture == null) {
            Toast.makeText(this, "相机未就绪", Toast.LENGTH_SHORT).show();
            return;
        }

        shootButton.setEnabled(false);

        String timestamp = new SimpleDateFormat("yyyyMMdd_HHmmss_SSS", Locale.getDefault()).format(new Date());
        String safeGroupId = currentGroupId.replaceAll("[^a-zA-Z0-9_]", "_");
        File outputFile = new File(pendingDir, "photo_" + timestamp + "_" + safeGroupId + ".jpg");

        ImageCapture.OutputFileOptions outputOptions =
            new ImageCapture.OutputFileOptions.Builder(outputFile).build();

        imageCapture.takePicture(
            outputOptions,
            ContextCompat.getMainExecutor(this),
            new ImageCapture.OnImageSavedCallback() {
                @Override
                public void onImageSaved(@NonNull ImageCapture.OutputFileResults results) {
                    photoCount++;
                    updateCount();
                    shootButton.setEnabled(true);
                    String groupInfo = currentGroupId.equals("未分组") ? "" : " [" + currentGroupId + "]";
                    Toast.makeText(QuickCaptureActivity.this, "已拍 " + photoCount + " 张" + groupInfo, Toast.LENGTH_SHORT).show();
                }

                @Override
                public void onError(@NonNull ImageCaptureException exception) {
                    shootButton.setEnabled(true);
                    Toast.makeText(QuickCaptureActivity.this, "拍照失败: " + exception.getMessage(), Toast.LENGTH_SHORT).show();
                }
            }
        );
    }

    private void updateCount() {
        String groupText = groupCounter > 0 ? " | " + groupCounter + "组" : "";
        countView.setText("已拍: " + photoCount + " 张" + groupText);
        doneButton.setEnabled(photoCount > 0);
        doneButton.setAlpha(photoCount > 0 ? 1.0f : 0.5f);
    }

    private void finishCapture() {
        if (photoCount == 0) {
            Toast.makeText(this, "请先拍照", Toast.LENGTH_SHORT).show();
            return;
        }

        // 收集所有照片文件路径
        ArrayList<String> filePaths = new ArrayList<>();
        File[] files = pendingDir.listFiles();
        if (files != null) {
            for (File f : files) {
                if (f.getName().startsWith("photo_")) {
                    filePaths.add(f.getAbsolutePath());
                }
            }
        }

        // 构建分组信息 JSON
        String groupInfo = "{\"total_groups\":" + groupCounter + ",\"total_photos\":" + photoCount + "}";

        // 启动 MainActivity 并传入文件路径
        Intent intent = new Intent(this, MainActivity.class);
        intent.putStringArrayListExtra(EXTRA_PENDING_PATHS, filePaths);
        intent.putExtra(EXTRA_GROUP_INFO, groupInfo);
        intent.putExtra(EXTRA_PENDING_COUNT, photoCount);
        intent.setFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        startActivity(intent);
        finish();
    }

    private void cancelCapture() {
        // 删除已拍的照片
        if (pendingDir.exists()) {
            File[] files = pendingDir.listFiles();
            if (files != null) {
                for (File f : files) f.delete();
            }
        }
        setResult(RESULT_CANCELED);
        finish();
    }

    @Override
    protected void onDestroy() {
        if (cameraExecutor != null) cameraExecutor.shutdown();
        super.onDestroy();
    }
}
