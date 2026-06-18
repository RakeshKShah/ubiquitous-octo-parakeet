import jwt from "jsonwebtoken";
import { Request, Response, NextFunction } from "express";
import { prisma } from "../utils/prisma";
import { Role, UserStatus } from "@prisma/client";

export type AuthUser = {
  id: string;
  email: string;
  role: Role;
  status: UserStatus;
  sellerProfileId?: string;
};

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

const JWT_SECRET = process.env.JWT_SECRET ?? "dev-secret";

export function signToken(user: AuthUser): string {
  return jwt.sign(user, JWT_SECRET, { expiresIn: "7d" });
}

export function verifyToken(token: string): AuthUser {
  return jwt.verify(token, JWT_SECRET) as AuthUser;
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  try {
    const payload = verifyToken(header.slice(7));
    const user = await prisma.user.findUnique({
      where: { id: payload.id },
      include: { sellerProfile: true },
    });
    if (!user) return res.status(401).json({ error: "Unauthorized" });
    req.user = {
      id: user.id,
      email: user.email,
      role: user.role,
      status: user.status,
      sellerProfileId: user.sellerProfile?.id,
    };
    next();
  } catch {
    return res.status(401).json({ error: "Invalid token" });
  }
}

export function requireRole(...roles: Role[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: "Forbidden" });
    }
    next();
  };
}

export function requireActiveSeller(req: Request, res: Response, next: NextFunction) {
  if (!req.user || req.user.role !== "SELLER") {
    return res.status(403).json({ error: "Seller access required" });
  }
  if (req.user.status !== "ACTIVE") {
    return res.status(403).json({ error: "Seller account must be active" });
  }
  next();
}

export function optionalAuth(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return next();
  try {
    req.user = verifyToken(header.slice(7));
  } catch {
    // ignore invalid token for public routes
  }
  next();
}
