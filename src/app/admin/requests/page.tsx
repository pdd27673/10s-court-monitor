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
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-4 border-green-600 border-t-transparent rounded-full animate-spin"></div>
          <div className="text-gray-600 dark:text-gray-400">Loading requests...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold mb-2 text-gray-900 dark:text-white">Registration Requests</h1>
          <p className="text-gray-600 dark:text-gray-400">
            Review and approve new user registrations
          </p>
        </div>
        {pendingCount > 0 && (
          <span className="px-4 py-2 bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-200 rounded-lg font-semibold border border-yellow-200 dark:border-yellow-800 shadow-sm">
            {pendingCount} pending
          </span>
        )}
      </div>

      {message && (
        <div
          className={`p-4 rounded-lg border shadow-sm ${
            message.type === "success"
              ? "bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800 text-green-800 dark:text-green-200"
              : "bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800 text-red-800 dark:text-red-200"
          }`}
        >
          <div className="flex items-center gap-2">
            {message.type === "success" ? (
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            ) : (
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            )}
            <p className="text-sm font-medium">{message.text}</p>
          </div>
        </div>
      )}

      {/* Filter Tabs */}
      <div className="flex gap-2 border-b dark:border-gray-700 bg-white dark:bg-gray-800 rounded-t-lg p-1">
        {(["all", "pending", "approved", "rejected"] as const).map((status) => (
          <button
            key={status}
            onClick={() => setFilter(status)}
            className={`px-4 py-2.5 font-medium text-sm transition-all duration-200 rounded-md capitalize relative ${
              filter === status
                ? "bg-green-600 text-white shadow-md"
                : "text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-700"
            }`}
          >
            {status}
            {status === "pending" && pendingCount > 0 && (
              <span className={`ml-2 px-2 py-0.5 rounded-full text-xs font-semibold ${
                filter === status
                  ? "bg-white/20 text-white"
                  : "bg-yellow-100 dark:bg-yellow-900 text-yellow-800 dark:text-yellow-200"
              }`}>
                {pendingCount}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Requests List */}
      <div className="space-y-4">
        {filteredRequests.length === 0 ? (
          <div className="bg-white dark:bg-gray-800 rounded-lg border dark:border-gray-700 p-12 text-center shadow-sm">
            <div className="text-4xl mb-3">📋</div>
            <p className="text-gray-500 dark:text-gray-400 font-medium">
              No {filter !== "all" ? filter : ""} requests found
            </p>
          </div>
        ) : (
          filteredRequests.map((request) => (
            <div
              key={request.id}
              className="bg-white dark:bg-gray-800 rounded-lg border dark:border-gray-700 p-6 shadow-sm hover:shadow-md transition-shadow"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-3">
                    <h3 className="font-semibold text-lg text-gray-900 dark:text-white">{request.email}</h3>
                    <span
                      className={`px-3 py-1 text-xs font-medium rounded-md border ${
                        request.status === "pending"
                          ? "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300 border-yellow-200 dark:border-yellow-800"
                          : request.status === "approved"
                            ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300 border-green-200 dark:border-green-800"
                            : "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300 border-red-200 dark:border-red-800"
                      }`}
                    >
                      {request.status}
                    </span>
                  </div>
                  {request.name && (
                    <p className="text-sm text-gray-600 dark:text-gray-400 mb-2">
                      <span className="font-medium">Name:</span> {request.name}
                    </p>
                  )}
                  <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">
                    <span className="font-medium">Submitted:</span> {new Date(request.createdAt).toLocaleString()}
                  </p>
                  {request.reason && (
                    <div className="mt-4 p-4 bg-gray-50 dark:bg-gray-900/50 rounded-lg border border-gray-200 dark:border-gray-700">
                      <p className="text-sm font-semibold mb-2 text-gray-700 dark:text-gray-300">Reason:</p>
                      <p className="text-sm text-gray-700 dark:text-gray-300">{request.reason}</p>
                    </div>
                  )}
                  {request.reviewedAt && (
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-3">
                      <span className="font-medium">Reviewed:</span> {new Date(request.reviewedAt).toLocaleString()}
                    </p>
                  )}
                </div>
                <div className="flex flex-col gap-2">
                  {request.status === "pending" && (
                    <>
                      <button
                        onClick={() => handleApprove(request.id, request.email)}
                        className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 text-sm font-medium transition-colors shadow-sm hover:shadow-md"
                      >
                        Approve
                      </button>
                      <button
                        onClick={() => handleReject(request.id, request.email)}
                        className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 text-sm font-medium transition-colors shadow-sm hover:shadow-md"
                      >
                        Reject
                      </button>
                    </>
                  )}
                  <button
                    onClick={() => handleDelete(request.id, request.email)}
                    className="px-4 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700 text-sm font-medium transition-colors shadow-sm hover:shadow-md"
                  >
                    Delete
                  </button>
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      <div className="text-sm text-gray-600 dark:text-gray-400 font-medium">
        Showing {filteredRequests.length} of {requests.length} requests
      </div>
    </div>
  );
}
