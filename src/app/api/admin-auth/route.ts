import { NextResponse } from "next/server";
import { createHash, timingSafeEqual } from "node:crypto";

function hashPassword(pass: string): Buffer {
  return createHash("sha256").update(pass).digest();
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { password } = body;
    if (typeof password !== "string") {
      return NextResponse.json({ ok: false, error: "Password must be a string." }, { status: 400 });
    }

    const targetPassword = process.env.ADMIN_PASSWORD || "Rocky@2005";
    const targetHash = hashPassword(targetPassword);
    const inputHash = hashPassword(password);
    const isValid = inputHash.length === targetHash.length && timingSafeEqual(inputHash, targetHash);

    if (isValid) {
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ ok: false, error: "Incorrect admin password." }, { status: 401 });
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid request payload." }, { status: 400 });
  }
}
