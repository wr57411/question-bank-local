package com.questionbank.local;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.DashPathEffect;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.RectF;
import android.util.AttributeSet;
import android.view.View;

public class DetectionOverlayView extends View {
    private final Paint maskPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint framePaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint guidePaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private boolean locked = false;

    public DetectionOverlayView(Context context) {
        this(context, null);
    }

    public DetectionOverlayView(Context context, AttributeSet attrs) {
        this(context, attrs, 0);
    }

    public DetectionOverlayView(Context context, AttributeSet attrs, int defStyleAttr) {
        super(context, attrs, defStyleAttr);
        maskPaint.setColor(0x7A000000);
        maskPaint.setStyle(Paint.Style.FILL);
        framePaint.setStyle(Paint.Style.STROKE);
        framePaint.setStrokeWidth(dp(3));
        framePaint.setColor(Color.WHITE);
        guidePaint.setStyle(Paint.Style.STROKE);
        guidePaint.setStrokeWidth(dp(2));
        guidePaint.setColor(0x99FFFFFF);
        guidePaint.setPathEffect(new DashPathEffect(new float[] { dp(10), dp(8) }, 0));
    }

    public void setLocked(boolean isLocked) {
        locked = isLocked;
        invalidate();
    }

    public void clearDetection() {
        locked = false;
        invalidate();
    }

    @Override
    protected void onDraw(Canvas canvas) {
        super.onDraw(canvas);
        drawCenterGuide(canvas);
    }

    private void drawCenterGuide(Canvas canvas) {
        float boxWidth = getWidth() * 0.62f;
        float boxHeight = getHeight() * 0.18f;
        float left = (getWidth() - boxWidth) / 2f;
        float top = (getHeight() - boxHeight) / 2f;
        RectF guide = new RectF(left, top, left + boxWidth, top + boxHeight);
        Path mask = new Path();
        mask.addRect(0, 0, getWidth(), getHeight(), Path.Direction.CW);
        mask.addRoundRect(guide, dp(18), dp(18), Path.Direction.CCW);
        canvas.drawPath(mask, maskPaint);
        guidePaint.setColor(locked ? 0xFF22C55E : 0x99FFFFFF);
        canvas.drawRoundRect(guide, dp(18), dp(18), guidePaint);
        framePaint.setColor(locked ? 0xFF22C55E : Color.WHITE);
        framePaint.setAlpha(locked ? 255 : 120);
        canvas.drawLine(guide.centerX(), guide.top + dp(10), guide.centerX(), guide.bottom - dp(10), framePaint);
        canvas.drawLine(guide.left + dp(10), guide.centerY(), guide.right - dp(10), guide.centerY(), framePaint);
        framePaint.setAlpha(255);
    }

    private float dp(float value) {
        return value * getResources().getDisplayMetrics().density;
    }
}
