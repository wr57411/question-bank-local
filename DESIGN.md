---
version: 1.0
name: question-bank-bright-friendly
description: 本地题库 App 设计契约 —— 明亮友好型视觉语言：珊瑚橙主色 + 糖果副色 + 大圆角软阴影，传递友好、陪伴、有成就感的学习管理气质。

colors:
  primary: "#FF7847"
  primary-dark: "#E85D2C"
  primary-soft: "#FFF1E9"
  primary-mid: "#FFD3BE"
  on-primary: "#FFFFFF"
  mint: "#3ED598"
  mint-deep: "#1FA974"
  mint-soft: "#E4F9F0"
  sky: "#4CC3FF"
  sky-deep: "#1E8FD8"
  sky-soft: "#E5F6FF"
  sun: "#FFC53D"
  sun-deep: "#B98A2F"
  sun-soft: "#FFF6DE"
  grape: "#9D7BFF"
  grape-deep: "#7C58E8"
  grape-soft: "#F0EBFF"
  danger: "#FF5A6E"
  danger-soft: "#FFECEF"
  ink: "#2E2A3B"
  ink-2: "#8A87A0"
  ink-3: "#B9B6CB"
  surface: "#FFFFFF"
  canvas: "#F7F5FF"
  canvas-warm: "#FFF4EC"
  hairline: "#EFEBFF"

typography:
  display-lg:
    fontFamily: "PingFang SC, -apple-system, Noto Sans SC, sans-serif"
    fontSize: 26px
    fontWeight: 800
    lineHeight: 1.2
    letterSpacing: -0.5px
  heading-md:
    fontFamily: "PingFang SC, -apple-system, Noto Sans SC, sans-serif"
    fontSize: 17px
    fontWeight: 800
    lineHeight: 1.3
  body-md:
    fontFamily: "PingFang SC, -apple-system, Noto Sans SC, sans-serif"
    fontSize: 14px
    fontWeight: 500
    lineHeight: 1.6
  body-sm:
    fontFamily: "PingFang SC, -apple-system, Noto Sans SC, sans-serif"
    fontSize: 13px
    fontWeight: 500
    lineHeight: 1.55
  caption:
    fontFamily: "PingFang SC, -apple-system, Noto Sans SC, sans-serif"
    fontSize: 11px
    fontWeight: 600
    lineHeight: 1.4
  button-md:
    fontFamily: "PingFang SC, -apple-system, Noto Sans SC, sans-serif"
    fontSize: 14px
    fontWeight: 700
    lineHeight: 1.2

rounded:
  sm: 10px
  md: 18px
  lg: 26px
  full: 999px

spacing:
  xs: 4px
  sm: 8px
  md: 16px
  lg: 24px
  xl: 32px

elevation:
  card: "0 6px 20px rgba(120,90,220,.08)"
  float: "0 12px 26px rgba(255,120,71,.45)"
  modal: "0 20px 60px rgba(90,60,180,.18)"

components:
  button-primary:
    backgroundColor: "linear-gradient(135deg, {colors.primary}, #FF9A62)"
    textColor: "{colors.on-primary}"
    typography: "{typography.button-md}"
    rounded: "{rounded.md}"
    padding: "13px 20px"
  button-secondary:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
  card-default:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
    elevation: "{elevation.card}"
    padding: "15px 16px"
  chip:
    rounded: "{rounded.full}"
    padding: "8px 15px"
    typography: "{typography.caption}"
  badge:
    rounded: "{rounded.full}"
    typography: "{typography.caption}"
  fab:
    backgroundColor: "linear-gradient(135deg, {colors.primary}, #FF9A62)"
    rounded: 22px
    size: 58px
    elevation: "{elevation.float}"
---

# DESIGN.md · 本地题库 明亮友好型

## Overview

面向学生的本地题库与学习管理工具。视觉语言取「学习陪伴」品类标准解法：
明亮珊瑚橙主色驱动主操作与成就感元素；mint/sky/sun/grape 四色糖果副色
承担学科与语义状态；大圆角 + 紫调软阴影营造轻盈卡片感。禁止 3D 硬投影、
细线边框堆叠与低饱和工具风。

## Colors

- primary 珊瑚橙：主按钮、FAB、激活态、成就卡渐变
- mint：成功/已掌握/同步完成
- sky：数学/信息类标签
- sun：警告/待复习
- grape：AI/知识卡/强调
- danger 草莓红：错误/待处理/删除
- 学科与状态一律用 soft 底 + deep 字色的糖果 badge 组合

## Typography

PingFang SC 体系；标题 800 字重带负字距；正文 500；caption 600。

## Shapes

卡片 rounded.lg(26px)；按钮/输入框 rounded.md(18px)；chips/badges rounded.full。

## Elevation

无硬边框卡片，仅紫调软阴影；FAB 与主按钮用橙色投影；按压反馈为 scale(.97) 而非位移。

## Do's and Don'ts

Do: 一切颜色/圆角/阴影引用 token；badge 用 soft+deep 组合。
Don't: 功能代码硬编码 hex；使用 3D 底部投影；直角或小圆角(≤8px)卡片。
