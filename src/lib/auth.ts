import NextAuth from "next-auth";
import { Resend } from "resend";
import { db } from "./db";
import { users, verificationTokens } from "./schema";
import { eq, and } from "drizzle-orm";
import type { Adapter } from "next-auth/adapters";
import type { Provider } from "next-auth/providers";

// Resend client for HTTP-based email (works on Railway where SMTP is blocked)
const resend = process.env.RESEND_API_KEY
  ? new Resend(process.env.RESEND_API_KEY)
  : null;

// Custom email provider using Resend HTTP API
function ResendProvider(): Provider {
  console.log("Using Resend email provider");
  return {
    id: "resend",
    name: "Email",
    type: "email",
    maxAge: 24 * 60 * 60, // 24 hours
    sendVerificationRequest: async ({ identifier: email, url }) => {
      if (!resend) {
        throw new Error("RESEND_API_KEY is not configured");
      }
      const result = await resend.emails.send({
        from: process.env.EMAIL_FROM || "Tennis Court Notifier <onboarding@resend.dev>",
        to: email,
        subject: "Sign in to Tennis Court Notifier",
        html: `
          <div style="font-family: sans-serif; max-width: 500px; margin: 0 auto;">
            <h2>Sign in to Tennis Court Notifier</h2>
            <p>Click the button below to sign in:</p>
            <a href="${url}" style="display: inline-block; background: #22c55e; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; margin: 16px 0;">
              Sign in
            </a>
            <p style="color: #666; font-size: 14px;">If you didn't request this email, you can safely ignore it.</p>
            <p style="color: #666; font-size: 12px;">This link expires in 24 hours.</p>
          </div>
        `,
      });
      console.log("Resend email result:", result.error ? result.error : result);
      if (result.error) {
        throw new Error(`Resend error: ${result.error.message}`);
      }
    },
  };
}

// Custom adapter for our database schema
// We use integer user IDs (not UUIDs), so we can't use the standard DrizzleAdapter
const customAdapter: Adapter = {
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

  async createUser(data) {
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
    return undefined;
  },

  async createSession() {
    throw new Error("JWT strategy - sessions not stored in DB");
  },

  async getSessionAndUser() {
    return null;
  },

  async updateSession() {
    throw new Error("JWT strategy - sessions not stored in DB");
  },

  async deleteSession() {
    return undefined;
  },
};

export const { handlers, signIn, signOut, auth } = NextAuth({
  adapter: customAdapter,
  providers: [ResendProvider()],
  pages: {
    signIn: "/login",
    verifyRequest: "/login/check-email",
    error: "/login/error",
  },
  callbacks: {
    async signIn({ user, email }) {
      if (!user.email) return false;

      // For email provider: check allowlist before sending the magic link
      // email.verificationRequest is true when requesting the link, false when clicking it
      if (email?.verificationRequest) {
        const dbUser = await db.query.users.findFirst({
          where: eq(users.email, user.email),
        });
        // Only send magic link to users who exist AND are allowed
        if (!dbUser || !dbUser.isAllowed) {
          return false;
        }
      }

      return true;
    },
    async jwt({ token, user }) {
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
