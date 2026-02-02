import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { users, registrationRequests } from "@/lib/schema";
import { eq } from "drizzle-orm";
import { sendEmail } from "@/lib/notifiers/email";

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();

    if (!session?.user?.email) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Check if user is admin
    const adminUser = await db.select().from(users).where(eq(users.email, session.user.email)).limit(1);
    if (!adminUser[0] || !adminUser[0].isAdmin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id } = await params;
    const requestId = parseInt(id, 10);
    const body = await request.json();
    const { action } = body; // "approve" or "reject"

    // Get the registration request
    const [regRequest] = await db
      .select()
      .from(registrationRequests)
      .where(eq(registrationRequests.id, requestId));

    if (!regRequest) {
      return NextResponse.json({ error: "Request not found" }, { status: 404 });
    }

    if (action === "approve") {
      // Check if user already exists (might have tried to log in before approval)
      const existingUser = await db
        .select()
        .from(users)
        .where(eq(users.email, regRequest.email))
        .limit(1);

      let user;
      if (existingUser.length > 0) {
        // User exists, update their allowlist status
        const [updatedUser] = await db
          .update(users)
          .set({
            isAllowed: 1,
            name: regRequest.name || existingUser[0].name,
          })
          .where(eq(users.email, regRequest.email))
          .returning();
        user = updatedUser;
      } else {
        // User doesn't exist, create new account
        const [newUser] = await db
          .insert(users)
          .values({
            email: regRequest.email,
            name: regRequest.name,
            isAllowed: 1,
          })
          .returning();
        user = newUser;
      }

      // Update request status
      await db
        .update(registrationRequests)
        .set({
          status: "approved",
          reviewedAt: new Date().toISOString(),
          reviewedBy: adminUser[0].id,
        })
        .where(eq(registrationRequests.id, requestId));

      // Send welcome email
      try {
        await sendEmail(
          regRequest.email,
          "Welcome to Time for Tennis!",
          `
            <h2>Your access has been approved!</h2>
            <p>Welcome to Time for Tennis, ${regRequest.name || ""}!</p>
            <p>Your registration request has been approved. You can now sign in and start using the service.</p>
            <p>
              <a href="${process.env.NEXTAUTH_URL}/login" style="display: inline-block; padding: 10px 20px; background-color: #16a34a; color: white; text-decoration: none; border-radius: 5px;">
                Sign In Now
              </a>
            </p>
            <p>Once signed in, you can:</p>
            <ul>
              <li>View real-time court availability across London</li>
              <li>Set up custom watch preferences for your favorite venues and times</li>
              <li>Receive instant notifications when courts become available</li>
            </ul>
            <p>Happy playing!</p>
          `
        );
      } catch (emailError) {
        console.error("Failed to send welcome email:", emailError);
      }

      return NextResponse.json({ success: true, user });
    } else if (action === "reject") {
      // Update request status
      await db
        .update(registrationRequests)
        .set({
          status: "rejected",
          reviewedAt: new Date().toISOString(),
          reviewedBy: adminUser[0].id,
        })
        .where(eq(registrationRequests.id, requestId));

      // Send rejection email
      try {
        await sendEmail(
          regRequest.email,
          "Time for Tennis - Registration Update",
          `
            <h2>Thank you for your interest</h2>
            <p>Thank you for your interest in Time for Tennis.</p>
            <p>Unfortunately, we're unable to approve your registration request at this time.</p>
            <p>If you have any questions, please feel free to reach out.</p>
          `
        );
      } catch (emailError) {
        console.error("Failed to send rejection email:", emailError);
      }

      return NextResponse.json({ success: true });
    } else {
      return NextResponse.json({ error: "Invalid action" }, { status: 400 });
    }
  } catch (error) {
    console.error("Error processing registration request:", error);
    return NextResponse.json({ error: "Failed to process request" }, { status: 500 });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();

    if (!session?.user?.email) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Check if user is admin
    const adminUser = await db.select().from(users).where(eq(users.email, session.user.email)).limit(1);
    if (!adminUser[0] || !adminUser[0].isAdmin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id } = await params;
    const requestId = parseInt(id, 10);

    await db.delete(registrationRequests).where(eq(registrationRequests.id, requestId));

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting registration request:", error);
    return NextResponse.json({ error: "Failed to delete request" }, { status: 500 });
  }
}
