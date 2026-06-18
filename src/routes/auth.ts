import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "../utils/prisma";
import { requireAuth, signToken } from "../middleware/auth";

const router = Router();

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  role: z.enum(["BUYER", "SELLER"]),
  storeName: z.string().optional(),
  bio: z.string().optional(),
});

router.post("/register", async (req, res) => {
  try {
    const data = registerSchema.parse(req.body);
    const existing = await prisma.user.findUnique({ where: { email: data.email } });
    if (existing) return res.status(400).json({ error: "Email already registered" });

    const passwordHash = await bcrypt.hash(data.password, 10);
    const status = data.role === "SELLER" ? "PENDING" : "ACTIVE";

    const user = await prisma.user.create({
      data: {
        email: data.email,
        passwordHash,
        role: data.role,
        status,
        ...(data.role === "SELLER"
          ? {
              sellerProfile: {
                create: {
                  storeName: data.storeName ?? "My Shop",
                  bio: data.bio ?? "",
                },
              },
            }
          : {}),
      },
      include: { sellerProfile: true },
    });

    const token = signToken({
      id: user.id,
      email: user.email,
      role: user.role,
      status: user.status,
      sellerProfileId: user.sellerProfile?.id,
    });

    res.status(201).json({
      token,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        status: user.status,
        sellerProfile: user.sellerProfile,
      },
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: err.issues[0]?.message });
    }
    res.status(500).json({ error: "Registration failed" });
  }
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
});

router.post("/login", async (req, res) => {
  try {
    const data = loginSchema.parse(req.body);
    const user = await prisma.user.findUnique({
      where: { email: data.email },
      include: { sellerProfile: true },
    });
    if (!user) return res.status(401).json({ error: "Invalid credentials" });

    const valid = await bcrypt.compare(data.password, user.passwordHash);
    if (!valid) return res.status(401).json({ error: "Invalid credentials" });

    const token = signToken({
      id: user.id,
      email: user.email,
      role: user.role,
      status: user.status,
      sellerProfileId: user.sellerProfile?.id,
    });

    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        status: user.status,
        sellerProfile: user.sellerProfile,
      },
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: err.issues[0]?.message });
    }
    res.status(500).json({ error: "Login failed" });
  }
});

router.get("/me", requireAuth, async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.user!.id },
    include: { sellerProfile: true },
  });
  if (!user) return res.status(404).json({ error: "User not found" });
  res.json({
    id: user.id,
    email: user.email,
    role: user.role,
    status: user.status,
    sellerProfile: user.sellerProfile,
  });
});

export default router;
