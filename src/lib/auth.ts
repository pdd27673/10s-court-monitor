import NextAuth from "next-auth";
import Nodemailer from "next-auth/providers/nodemailer";
import { db } from "./db";
import { users, verificationTokens } from "./schema";
import { eq, and } from "drizzle-orm";
import type { Adapter } from "next-auth/adapters";

// Custom adapter for verification tokens only
// We use integer user IDs (not UUIDs), so we can't use the standard DrizzleAdapter
// This adapter only implements the methods needed for magic link authentication
const verificationTokenAdapter: Adapter = {
  async createVerificationToken(data) {
    await db.insert(verificationTokens).values({
      identifier: data.identifier,
      token: data.token,
      expires: data.expires.toISOString(),
    });
    return data;
  },

  async useVerificationToken(params) {
    const result = await db
      .select()
      .from(verificationTokens)
      .where(
        and(
          eq(verificationTokens.identifier, params.identifier),
          eq(verificationTokens.token, params.token)
        )
      );

    if (result.length === 0) return null;

    const token = result[0];

    await db
      .delete(verificationTokens)
      .where(
        and(
          eq(verificationTokens.identifier, params.identifier),
          eq(verificationTokens.token, params.token)
        )
      );

    return {
      identifier: token.identifier,
      token: token.token,
      expires: new Date(token.expires),
    };
  },

  // User methods
  async createUser(data) {
    // We don't create users through NextAuth - users are pre-added to allowlist
    // But NextAuth may call this, so we return the data as-is
    const result = await db.insert(users).values({
      email: data.email,
      name: data.name ?? null,
      emailVerified: data.emailVerified?.toISOString() ?? null,
      image: data.image ?? null,
      isAllowed: 0, // New users not allowed by default
    }).returning();
    const newUser = result[0];
    return {
      id: String(newUser.id),
      email: newUser.email,
      emailVerified: newUser.emailVerified ? new Date(newUser.emailVerified) : null,
      name: newUser.name,
      image: newUser.image,
    };
  },

  async getUser(id) {
    const dbUser = await db.query.users.findFirst({
      where: eq(users.id, parseInt(id)),
    });
    if (!dbUser) return null;
    return {
      id: String(dbUser.id),
      email: dbUser.email,
      emailVerified: dbUser.emailVerified ? new Date(dbUser.emailVerified) : null,
      name: dbUser.name,
      image: dbUser.image,
    };
  },

  async getUserByEmail(email) {
    const dbUser = await db.query.users.findFirst({
      where: eq(users.email, email),
    });
    if (!dbUser) return null;
    return {
      id: String(dbUser.id),
      email: dbUser.email,
      emailVerified: dbUser.emailVerified ? new Date(dbUser.emailVerified) : null,
      name: dbUser.name,
      image: dbUser.image,
    };
  },

  async getUserByAccount() {
    // We don't use OAuth accounts, only magic link
    return null;
  },

  async updateUser(data) {
    const updateData: Record<string, unknown> = {};
    if (data.email !== undefined) updateData.email = data.email;
    if (data.name !== undefined) updateData.name = data.name;
    if (data.image !== undefined) updateData.image = data.image;
    if (data.emailVerified !== undefined) {
      updateData.emailVerified = data.emailVerified?.toISOString() ?? null;
    }

    if (Object.keys(updateData).length > 0) {
      await db
        .update(users)
        .set(updateData)
        .where(eq(users.id, parseInt(data.id!)));
    }

    const dbUser = await db.query.users.findFirst({
      where: eq(users.id, parseInt(data.id!)),
    });
    if (!dbUser) throw new Error("User not found");
    return {
      id: String(dbUser.id),
      email: dbUser.email,
      emailVerified: dbUser.emailVerified ? new Date(dbUser.emailVerified) : null,
      name: dbUser.name,
      image: dbUser.image,
    };
  },

  async linkAccount() {
    // We don't use OAuth accounts
    return undefined;
  },

  // Session methods - not used with JWT strategy but required by interface
  async createSession() {
    throw new Error("JWT strategy - sessions not stored in DB");
  },

  async getSessionAndUser() {
    // JWT strategy - sessions not stored in DB
    return null;
  },

  async updateSession() {
    throw new Error("JWT strategy - sessions not stored in DB");
  },

  async deleteSession() {
    // JWT strategy - sessions not stored in DB
    return undefined;
  },
};

export const { handlers, signIn, signOut, auth } = NextAuth({
  adapter: verificationTokenAdapter,
  providers: [
    Nodemailer({
      server: {
        host: process.env.SMTP_HOST || "smtp.gmail.com",
        port: parseInt(process.env.SMTP_PORT || "465"),
        secure: process.env.SMTP_PORT === "587" ? false : true,
        auth: {
          user: process.env.GMAIL_USER,
          pass: process.env.GMAIL_APP_PASSWORD,
        },
        connectionTimeout: 10000,
      },
      from: process.env.GMAIL_USER,
    }),
  ],
  pages: {
    signIn: "/login",
    verifyRequest: "/login/check-email",
    error: "/login/error",
  },
  callbacks: {
    async signIn({ user }) {
      // Check if user is in the allowlist
      if (!user.email) return false;

      const dbUser = await db.query.users.findFirst({
        where: eq(users.email, user.email),
      });

      // Only allow users who exist AND are marked as allowed
      if (!dbUser || !dbUser.isAllowed) {
        return false;
      }

      return true;
    },
    async jwt({ token, user }) {
      // On sign in, fetch the database user and add their ID to the token
      if (user?.email) {
        const dbUser = await db.query.users.findFirst({
          where: eq(users.email, user.email),
        });
        if (dbUser) {
          token.userId = dbUser.id;
        }
      }
      return token;
    },
    async session({ session, token }) {
      // Add user ID from JWT token to session
      if (session.user && token.userId) {
        session.user.id = String(token.userId);
      }
      return session;
    },
  },
  session: {
    strategy: "jwt",
    maxAge: 30 * 24 * 60 * 60, // 30 days
  },
});
