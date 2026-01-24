"use client";

import { useEffect, useState } from "react";

interface RegistrationRequest {
  id: number;
  email: string;
  name: string | null;
  reason: string | null;
  status: string;
  createdAt: string;
  reviewedAt: string | null;
}

export default function RegistrationRequests() {
  const [requests, setRequests] = useState<RegistrationRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [filter, setFilter] = useState<"all" | "pending" | "approved" | "rejected">("pending");

  useEffect(() => {
    fetchRequests();
  }, []);

  const fetchRequests = async () => {
    try {
      const res = await fetch("/api/admin/requests");
      const data = await res.json();
      setRequests(data.requests);
    } catch (error) {
      console.error("Failed to fetch requests:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleApprove = async (requestId: number, email: string) => {
    if (!confirm(`Approve registration for ${email}?`)) return;

    try {
      const res = await fetch(`/api/admin/requests/${requestId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "approve" }),
      });

      if (!res.ok) throw new Error("Failed to approve request");

      await fetchRequests();
      showMessage("success", `Approved ${email} - account created and welcome email sent`);
    } catch (error) {
      showMessage("error", "Failed to approve request");
    }
  };

  const handleReject = async (requestId: number, email: string) => {
    if (!confirm(`Reject registration for ${email}? They will be notified via email.`)) return;

    try {
      const res = await fetch(`/api/admin/requests/${requestId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reject" }),
      });

      if (!res.ok) throw new Error("Failed to reject request");

      await fetchRequests();
      showMessage("success", `Rejected ${email} - rejection email sent`);
    } catch (error) {
      showMessage("error", "Failed to reject request");
    }
  };

  const handleDelete = async (requestId: number, email: string) => {
    if (!confirm(`Delete registration request from ${email}? This action cannot be undone.`)) return;

    try {
      const res = await fetch(`/api/admin/requests/${requestId}`, {
        method: "DELETE",
      });

      if (!res.ok) throw new Error("Failed to delete request");

      await fetchRequests();
      showMessage("success", "Request deleted");
    } catch (error) {
      showMessage("error", "Failed to delete request");
    }
  };

  const showMessage = (type: "success" | "error", text: string) => {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), 5000);
  };

  const filteredRequests = requests.filter((req) =>
    filter === "all" ? true : req.status === filter
  );

  const pendingCount = requests.filter((r) => r.status === "pending").length;

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-gray-500">Loading...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold mb-2">Registration Requests</h1>
          <p className="text-gray-600 dark:text-gray-400">
            Review and approve new user registrations
          </p>
        </div>
        {pendingCount > 0 && (
          <span className="px-4 py-2 bg-yellow-100 dark:bg-yellow-900 text-yellow-800 dark:text-yellow-200 rounded-lg font-medium">
            {pendingCount} pending
          </span>
        )}
      </div>

      {message && (
        <div
          className={`p-4 rounded-lg ${
            message.type === "success"
              ? "bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 text-green-800 dark:text-green-200"
              : "bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-800 dark:text-red-200"
          }`}
        >
          <p className="text-sm">{message.text}</p>
        </div>
      )}

      {/* Filter Tabs */}
      <div className="flex gap-2 border-b dark:border-gray-700">
        {(["all", "pending", "approved", "rejected"] as const).map((status) => (
          <button
            key={status}
            onClick={() => setFilter(status)}
            className={`px-4 py-2 font-medium text-sm transition-colors border-b-2 -mb-px capitalize ${
              filter === status
                ? "border-green-600 text-green-600"
                : "border-transparent text-gray-500 hover:text-gray-700"
            }`}
          >
            {status}
            {status === "pending" && pendingCount > 0 && (
              <span className="ml-2 px-2 py-0.5 bg-yellow-100 dark:bg-yellow-900 text-yellow-800 dark:text-yellow-200 rounded-full text-xs">
                {pendingCount}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Requests List */}
      <div className="space-y-4">
        {filteredRequests.length === 0 ? (
          <div className="bg-white dark:bg-gray-800 rounded-lg border dark:border-gray-700 p-8 text-center text-gray-500">
            No {filter !== "all" ? filter : ""} requests found
          </div>
        ) : (
          filteredRequests.map((request) => (
            <div
              key={request.id}
              className="bg-white dark:bg-gray-800 rounded-lg border dark:border-gray-700 p-6"
            >
              <div className="flex items-start justify-between mb-4">
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-2">
                    <h3 className="font-semibold text-lg">{request.email}</h3>
                    <span
                      className={`px-2 py-1 text-xs rounded ${
                        request.status === "pending"
                          ? "bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300"
                          : request.status === "approved"
                            ? "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300"
                            : "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300"
                      }`}
                    >
                      {request.status}
                    </span>
                  </div>
                  {request.name && (
                    <p className="text-sm text-gray-600 dark:text-gray-400 mb-2">
                      Name: {request.name}
                    </p>
                  )}
                  <p className="text-sm text-gray-500 mb-3">
                    Submitted: {new Date(request.createdAt).toLocaleString()}
                  </p>
                  {request.reason && (
                    <div className="mt-3 p-3 bg-gray-50 dark:bg-gray-900 rounded">
                      <p className="text-sm font-medium mb-1">Reason:</p>
                      <p className="text-sm text-gray-700 dark:text-gray-300">{request.reason}</p>
                    </div>
                  )}
                  {request.reviewedAt && (
                    <p className="text-xs text-gray-500 mt-3">
                      Reviewed: {new Date(request.reviewedAt).toLocaleString()}
                    </p>
                  )}
                </div>
                <div className="flex gap-2">
                  {request.status === "pending" && (
                    <>
                      <button
                        onClick={() => handleApprove(request.id, request.email)}
                        className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 text-sm font-medium"
                      >
                        Approve
                      </button>
                      <button
                        onClick={() => handleReject(request.id, request.email)}
                        className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 text-sm font-medium"
                      >
                        Reject
                      </button>
                    </>
                  )}
                  <button
                    onClick={() => handleDelete(request.id, request.email)}
                    className="px-4 py-2 bg-gray-600 text-white rounded hover:bg-gray-700 text-sm font-medium"
                  >
                    Delete
                  </button>
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      <div className="text-sm text-gray-500">
        Showing {filteredRequests.length} of {requests.length} requests
      </div>
    </div>
  );
}
