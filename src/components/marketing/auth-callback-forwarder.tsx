"use client";

import { useEffect } from "react";

const AUTH_HASH_RE = /(?:^|[#&])(?:(?:access_token|refresh_token|error_description)=|type=(?:recovery|signup)(?:&|$))/;
const AUTH_QUERY_KEYS = ["code", "token_hash", "error_description"] as const;

export function AuthCallbackForwarder() {
  useEffect(() => {
    const { search, hash } = window.location;
    const params = new URLSearchParams(search);
    const hasAuthQuery = AUTH_QUERY_KEYS.some((key) => params.has(key));
    const hasAuthHash = AUTH_HASH_RE.test(hash);

    if (hasAuthQuery || hasAuthHash) {
      window.location.replace(`/app${search}${hash}`);
    }
  }, []);

  return null;
}
