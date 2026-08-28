import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import type { Request, Response, NextFunction } from 'express';
import db from '../db/connection.js';

const JWT_SECRET = process.env.JWT_SECRET || (() => {
  throw new Error('JWT_SECRET 环境变量未设置');
})();

export interface AuthRequest extends Request {
  userId: string;
}

function generateToken(userId: string): string {
  return jwt.sign({ userId }, JWT_SECRET, { expiresIn: '30d' });
}

function verifyToken(token: string): { userId: string } | null {
  try {
    return jwt.verify(token, JWT_SECRET) as { userId: string };
  } catch {
    return null;
  }
}

export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: '未登录' });
    return;
  }
  const decoded = verifyToken(authHeader.slice(7));
  if (!decoded) {
    res.status(401).json({ error: 'token 已过期' });
    return;
  }
  (req as AuthRequest).userId = decoded.userId;
  next();
}

export function register(phone: string, password: string, nickname?: string): { id?: string; token?: string; error?: string } {
  const existing = db.prepare('SELECT id FROM users WHERE phone = ?').get(phone);
  if (existing) {
    return { error: '手机号已注册' };
  }
  const id = uuidv4();
  const hashed = bcrypt.hashSync(password, 10);
  db.prepare('INSERT INTO users (id, phone, password, nickname) VALUES (?, ?, ?, ?)').run(id, phone, hashed, nickname || '');
  return { id, token: generateToken(id) };
}

export function login(phone: string, password: string): { id?: string; nickname?: string; token?: string; error?: string } {
  const user = db.prepare('SELECT * FROM users WHERE phone = ?').get(phone) as { id: string; password: string; nickname: string } | undefined;
  if (!user) {
    return { error: '用户不存在' };
  }
  if (!bcrypt.compareSync(password, user.password)) {
    return { error: '密码错误' };
  }
  return { id: user.id, nickname: user.nickname, token: generateToken(user.id) };
}
