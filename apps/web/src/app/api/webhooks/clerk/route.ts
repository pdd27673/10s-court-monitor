import { Webhook } from "svix";
import { headers } from "next/headers";
import { WebhookEvent } from "@clerk/nextjs/server";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema/users";
import { clerkClient } from "@clerk/nextjs/server";

export async function POST(req: Request) {
  // Get the headers
  const headerPayload = await headers();
  const svix_id = headerPayload.get("svix-id");
  const svix_timestamp = headerPayload.get("svix-timestamp");
  const svix_signature = headerPayload.get("svix-signature");

  // If there are no headers, error out
  if (!svix_id || !svix_timestamp || !svix_signature) {
    return new Response("Error occured -- no svix headers", {
      status: 400,
    });
  }

  // Get the body
  const payload = await req.text();

  // Get the Webhook secret
  const WEBHOOK_SECRET = process.env.CLERK_WEBHOOK_SECRET;

  if (!WEBHOOK_SECRET) {
    throw new Error("Please add CLERK_WEBHOOK_SECRET from Clerk Dashboard to .env or .env.local");
  }

  // Create a new Svix instance with your secret.
  const wh = new Webhook(WEBHOOK_SECRET);

  let evt: WebhookEvent;

  // Verify the payload with the headers
  try {
    evt = wh.verify(payload, {
      "svix-id": svix_id,
      "svix-timestamp": svix_timestamp,
      "svix-signature": svix_signature,
    }) as WebhookEvent;
  } catch (err) {
    console.error("Error verifying webhook:", err);
    return new Response("Error occured", {
      status: 400,
    });
  }

  // Handle the webhook
  const eventType = evt.type;

  if (eventType === "user.created") {
    try {
      const { email_addresses, id: clerkUserId } = evt.data;
      const primaryEmail = email_addresses.find(email => email.id === evt.data.primary_email_address_id);

      if (!primaryEmail) {
        console.error("No primary email found for user", clerkUserId);
        return new Response("No primary email", { status: 400 });
      }

      // Check if email is in whitelist
      const allowedEmails = process.env.ALLOWED_EMAILS?.split(",").map(email => email.trim()) || [];

      if (!allowedEmails.includes(primaryEmail.email_address)) {
        console.log(`User ${primaryEmail.email_address} not in whitelist, deleting...`);

        // Delete the user from Clerk
        const clerk = await clerkClient();
        await clerk.users.deleteUser(clerkUserId);

        return new Response("User not whitelisted and deleted", { status: 200 });
      }

      // User is whitelisted, add to database
      await db.insert(users).values({
        id: `user_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        clerkId: clerkUserId,
        email: primaryEmail.email_address,
        status: "active",
      });

      console.log(`User ${primaryEmail.email_address} whitelisted and synced to database`);

    } catch (error) {
      console.error("Error processing user.created webhook:", error);
      return new Response("Error processing webhook", { status: 500 });
    }
  }

  return new Response("", { status: 200 });
}