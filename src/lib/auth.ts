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

// Validate EMAIL_FROM is set at module load time
const EMAIL_FROM = process.env.EMAIL_FROM;
if (resend && !EMAIL_FROM) {
  console.error(
    "ERROR: EMAIL_FROM environment variable is not set. " +
    "Email authentication will fail. " +
    "Please set EMAIL_FROM to a verified domain in your Resend account (e.g., 'Your App <noreply@yourdomain.com>')."
  );
}

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
      
      if (!EMAIL_FROM) {
        throw new Error(
          "EMAIL_FROM environment variable is not set. " +
          "Please configure EMAIL_FROM with a verified domain in your Resend account. " +
          "Example: EMAIL_FROM='Your App <noreply@yourdomain.com>'"
        );
      }
      
      const result = await resend.emails.send({
        from: EMAIL_FROM,
        to: email,
        subject: "Sign in to Time for Tennis",
        html: `
          <div style="font-family: sans-serif; max-width: 500px; margin: 0 auto;">
            <h2>Sign in to Time for Tennis</h2>
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
    // Don't auto-create users - they should only be created through registration approval
    // This prevents "zombie" accounts for unapproved users
    // If we reach this point, the user was already checked in getUserByEmail and exists
    throw new Error("User creation should only happen through registration approval");
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
      where: eq(users.email, email.toLowerCase()),
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

      // Check if user exists and is allowed (normalize email to lowercase)
      const dbUser = await db.query.users.findFirst({
        where: eq(users.email, user.email.toLowerCase()),
      });

      // Only allow sign in if user exists AND is allowlisted
      // This prevents auto-creation of user accounts for unapproved users
      if (!dbUser || !dbUser.isAllowed) {
        return false;
      }

      return true;
    },
    async jwt({ token, user }) {
      if (user?.email) {
        const dbUser = await db.query.users.findFirst({
          where: eq(users.email, user.email.toLowerCase()),
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
