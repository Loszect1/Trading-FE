"use client";

import type { FormEvent } from "react";
import { useCallback, useEffect, useState } from "react";
import { useToast } from "@/components/toast-provider";
import { TOAST_MESSAGES } from "@/constants/toast-messages";
import { UI_TEXT } from "@/constants/ui-text";
import { hasDnseSession } from "@/lib/dnse-session";
import {
  dnseAuthLogin,
  dnseAuthLogout,
  extractDnseRecords,
  fetchDnseAccount,
  fetchDnseDefaults,
  fetchDnseSubAccounts,
  isAppError,
  pickSubAccountNumbers,
  placeDnseOrder,
  requestDnseEmailOtp,
} from "@/services/dnse.api";

const ORDER_TYPES = ["LO", "ATO", "ATC", "MOK", "MTL", "MP"] as const;

interface DnseTradePanelProps {
  symbol: string;
  defaultExpanded?: boolean;
}

function readInitialSubAccountFromEnv(): string {
  if (typeof process === "undefined") {
    return "";
  }
  return (process.env.NEXT_PUBLIC_DNSE_DEFAULT_SUB_ACCOUNT ?? "").trim();
}

export function DnseTradePanel({ symbol, defaultExpanded = false }: DnseTradePanelProps) {
  const { showToast } = useToast();
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [subAccount, setSubAccount] = useState(readInitialSubAccountFromEnv);
  const [formSymbol, setFormSymbol] = useState(symbol.toUpperCase());
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [quantity, setQuantity] = useState<string>("100");
  const [price, setPrice] = useState<string>("");
  const [orderType, setOrderType] = useState<string>("LO");
  const [assetType, setAssetType] = useState<"stock" | "derivative">("stock");
  const [loanPackageId, setLoanPackageId] = useState<string>("");
  const [otp, setOtp] = useState("");
  const [smartOtp, setSmartOtp] = useState(true);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [otpSending, setOtpSending] = useState(false);
  const [accountLoading, setAccountLoading] = useState(false);
  const [accountJson, setAccountJson] = useState<string>("");
  const [subAccountsLine, setSubAccountsLine] = useState<string>("");
  const [sessionActive, setSessionActive] = useState(false);
  const [sessionLoginLoading, setSessionLoginLoading] = useState(false);

  useEffect(() => {
    setFormSymbol(symbol.toUpperCase());
  }, [symbol]);

  useEffect(() => {
    setSessionActive(hasDnseSession());
  }, [expanded]);

  useEffect(() => {
    if (!expanded) {
      return;
    }
    let cancelled = false;
    void (async () => {
      const defaults = await fetchDnseDefaults();
      const fromBe = defaults.default_sub_account?.trim();
      if (cancelled || !fromBe) {
        return;
      }
      setSubAccount((prev) => (prev.trim() ? prev : fromBe));
    })();
    return () => {
      cancelled = true;
    };
  }, [expanded]);

  const credsPayload = useCallback(() => {
    const u = username.trim();
    const p = password;
    return {
      ...(u ? { username: u } : {}),
      ...(p ? { password: p } : {}),
    };
  }, [username, password]);

  const handleSessionLogin = async () => {
    if (!username.trim() || !password) {
      showToast(UI_TEXT.dnse.loginNeedCredentials, "error");
      return;
    }
    setSessionLoginLoading(true);
    try {
      await dnseAuthLogin(username.trim(), password);
      setSessionActive(true);
      setPassword("");
      showToast(TOAST_MESSAGES.dnseSessionSaved, "success");
    } catch (error) {
      const message = isAppError(error) ? error.message : TOAST_MESSAGES.dnseLoginFailed;
      showToast(message, "error");
    } finally {
      setSessionLoginLoading(false);
    }
  };

  const handleSessionLogout = () => {
    dnseAuthLogout();
    setSessionActive(false);
    showToast(TOAST_MESSAGES.dnseSessionCleared, "success");
  };

  const handleLoadAccountInfo = async () => {
    setAccountLoading(true);
    try {
      const creds = credsPayload();
      const [accRes, subRes] = await Promise.all([fetchDnseAccount(creds), fetchDnseSubAccounts(creds)]);
      const accRows = extractDnseRecords(accRes);
      const subRows = extractDnseRecords(subRes);
      const nums = pickSubAccountNumbers(subRows);
      setAccountJson(accRows[0] ? JSON.stringify(accRows[0], null, 2) : "(empty)");
      setSubAccountsLine(nums.length > 0 ? nums.join(", ") : "(empty)");
      setSubAccount((prev) => (prev.trim() ? prev : nums[0] ?? prev));
      showToast(TOAST_MESSAGES.dnseAccountLoaded, "success");
    } catch (error) {
      const message = isAppError(error) ? error.message : TOAST_MESSAGES.dnseAccountLoadFailed;
      showToast(message, "error");
    } finally {
      setAccountLoading(false);
    }
  };

  const handleRequestOtp = async () => {
    setOtpSending(true);
    try {
      await requestDnseEmailOtp(credsPayload());
      showToast(TOAST_MESSAGES.dnseOtpSent, "success");
    } catch (error) {
      const message = isAppError(error) ? error.message : UI_TEXT.dnse.otpFailed;
      showToast(message, "error");
    } finally {
      setOtpSending(false);
    }
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const qty = Number.parseInt(quantity, 10);
    const px = Number.parseFloat(price);
    if (!Number.isFinite(qty) || qty <= 0) {
      showToast(UI_TEXT.dnse.invalidQuantity, "error");
      return;
    }
    if (!Number.isFinite(px) || px <= 0) {
      showToast(UI_TEXT.dnse.invalidPrice, "error");
      return;
    }
    if (otp.trim().length < 4) {
      showToast(UI_TEXT.dnse.invalidOtp, "error");
      return;
    }
    if (!subAccount.trim()) {
      showToast(UI_TEXT.dnse.subAccountRequired, "error");
      return;
    }

    setSubmitting(true);
    try {
      const loanRaw = loanPackageId.trim();
      const loanParsed = loanRaw === "" ? undefined : Number.parseInt(loanRaw, 10);
      await placeDnseOrder({
        ...credsPayload(),
        otp: otp.trim(),
        smart_otp: smartOtp,
        sub_account: subAccount.trim(),
        symbol: formSymbol.trim().toUpperCase(),
        side,
        quantity: qty,
        price: px,
        order_type: orderType,
        asset_type: assetType,
        ...(loanParsed !== undefined && !Number.isNaN(loanParsed) ? { loan_package_id: loanParsed } : {}),
      });
      showToast(TOAST_MESSAGES.dnseOrderPlaced(formSymbol), "success");
      setOtp("");
    } catch (error) {
      const message = isAppError(error) ? error.message : UI_TEXT.dnse.placeFailed;
      showToast(message, "error");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="glass-panel rounded-xl p-4">
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        className="flex w-full items-center justify-between gap-2 text-left"
      >
        <span className="text-sm font-semibold text-cyan-100">{UI_TEXT.dnse.title}</span>
        <span className="text-xs text-slate-400">{expanded ? UI_TEXT.dnse.collapse : UI_TEXT.dnse.expand}</span>
      </button>
      <p className="mt-2 text-xs text-slate-400">{UI_TEXT.dnse.hint}</p>

      {expanded ? (
        <form onSubmit={handleSubmit} className="mt-4 space-y-3">
          <p className="text-xs text-slate-500">{UI_TEXT.dnse.sessionHint}</p>
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-white/10 bg-slate-950/40 px-3 py-2">
            <span className="text-xs text-slate-300">
              {sessionActive ? UI_TEXT.dnse.sessionActive : UI_TEXT.dnse.sessionNone}
            </span>
            {sessionActive ? (
              <button
                type="button"
                onClick={handleSessionLogout}
                className="rounded-md border border-white/25 bg-slate-900/60 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-800/80"
              >
                {UI_TEXT.dnse.sessionLogout}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void handleSessionLogin()}
                disabled={sessionLoginLoading}
                className="rounded-md border border-cyan-300/40 bg-cyan-500/15 px-3 py-1.5 text-xs font-medium text-cyan-100 hover:bg-cyan-500/25 disabled:opacity-50"
              >
                {sessionLoginLoading ? UI_TEXT.dnse.sessionLoggingIn : UI_TEXT.dnse.sessionLogin}
              </button>
            )}
          </div>
          <p className="text-xs text-slate-500">{UI_TEXT.dnse.accountInfoHint}</p>
          <button
            type="button"
            onClick={() => void handleLoadAccountInfo()}
            disabled={accountLoading}
            className="w-full rounded-md border border-cyan-300/35 bg-cyan-500/10 px-3 py-2 text-xs font-medium text-cyan-100 hover:bg-cyan-500/20 disabled:opacity-50 sm:w-auto"
          >
            {accountLoading ? UI_TEXT.dnse.loadingAccountInfo : UI_TEXT.dnse.loadAccountInfo}
          </button>
          {accountJson || subAccountsLine ? (
            <div className="grid gap-2 rounded-lg border border-white/10 bg-slate-950/40 p-3 text-xs text-slate-300 sm:grid-cols-2">
              <div>
                <p className="font-medium text-slate-200">{UI_TEXT.dnse.accountSummaryTitle}</p>
                <pre className="mt-1 max-h-36 overflow-auto whitespace-pre-wrap break-all text-[11px] text-slate-400">
                  {accountJson}
                </pre>
              </div>
              <div>
                <p className="font-medium text-slate-200">{UI_TEXT.dnse.subAccountsSummaryTitle}</p>
                <p className="mt-1 font-mono text-[11px] text-emerald-200/90">{subAccountsLine}</p>
              </div>
            </div>
          ) : null}
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-xs text-slate-300">
              {UI_TEXT.dnse.subAccount}
              <input
                value={subAccount}
                onChange={(event) => setSubAccount(event.target.value)}
                autoComplete="off"
                className="mt-1 h-10 w-full rounded-md border border-white/20 bg-slate-950/45 px-3 text-sm text-slate-100 outline-none focus:border-cyan-300/50"
                placeholder={UI_TEXT.dnse.subAccountPlaceholder}
              />
            </label>
            <label className="block text-xs text-slate-300">
              {UI_TEXT.dnse.symbol}
              <input
                value={formSymbol}
                onChange={(event) => setFormSymbol(event.target.value.toUpperCase())}
                autoComplete="off"
                className="mt-1 h-10 w-full rounded-md border border-white/20 bg-slate-950/45 px-3 font-mono text-sm text-slate-100 outline-none focus:border-cyan-300/50"
              />
            </label>
          </div>

          <div className="flex flex-wrap gap-2">
            <span className="w-full text-xs text-slate-300">{UI_TEXT.dnse.side}</span>
            {(["buy", "sell"] as const).map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setSide(value)}
                className={`rounded-md px-4 py-2 text-xs font-semibold ${
                  side === value
                    ? value === "buy"
                      ? "bg-emerald-400/25 text-emerald-100"
                      : "bg-rose-400/25 text-rose-100"
                    : "border border-white/20 bg-slate-950/45 text-slate-200 hover:bg-white/10"
                }`}
              >
                {value === "buy" ? UI_TEXT.dnse.buy : UI_TEXT.dnse.sell}
              </button>
            ))}
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <label className="block text-xs text-slate-300">
              {UI_TEXT.dnse.quantity}
              <input
                type="number"
                min={1}
                value={quantity}
                onChange={(event) => setQuantity(event.target.value)}
                className="mt-1 h-10 w-full rounded-md border border-white/20 bg-slate-950/45 px-3 text-sm text-slate-100 outline-none focus:border-cyan-300/50"
              />
            </label>
            <label className="block text-xs text-slate-300">
              {UI_TEXT.dnse.price}
              <input
                type="number"
                min={0}
                step="0.01"
                value={price}
                onChange={(event) => setPrice(event.target.value)}
                className="mt-1 h-10 w-full rounded-md border border-white/20 bg-slate-950/45 px-3 text-sm text-slate-100 outline-none focus:border-cyan-300/50"
              />
            </label>
            <label className="block text-xs text-slate-300">
              {UI_TEXT.dnse.orderType}
              <select
                value={orderType}
                onChange={(event) => setOrderType(event.target.value)}
                className="mt-1 h-10 w-full rounded-md border border-white/20 bg-slate-950/45 px-3 text-sm text-slate-100 outline-none focus:border-cyan-300/50"
              >
                {ORDER_TYPES.map((ot) => (
                  <option key={ot} value={ot}>
                    {ot}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-xs text-slate-300">
              {UI_TEXT.dnse.assetType}
              <select
                value={assetType}
                onChange={(event) => setAssetType(event.target.value as "stock" | "derivative")}
                className="mt-1 h-10 w-full rounded-md border border-white/20 bg-slate-950/45 px-3 text-sm text-slate-100 outline-none focus:border-cyan-300/50"
              >
                <option value="stock">{UI_TEXT.dnse.stock}</option>
                <option value="derivative">{UI_TEXT.dnse.derivative}</option>
              </select>
            </label>
            <label className="block text-xs text-slate-300">
              {UI_TEXT.dnse.loanPackageOptional}
              <input
                type="number"
                value={loanPackageId}
                onChange={(event) => setLoanPackageId(event.target.value)}
                className="mt-1 h-10 w-full rounded-md border border-white/20 bg-slate-950/45 px-3 text-sm text-slate-100 outline-none focus:border-cyan-300/50"
                placeholder="—"
              />
            </label>
          </div>

          <div className="rounded-lg border border-white/10 bg-slate-950/35 p-3">
            <p className="text-xs font-medium text-slate-300">{UI_TEXT.dnse.credentialsSection}</p>
            <p className="mt-1 text-xs text-slate-500">{UI_TEXT.dnse.credentialsHint}</p>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <input
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                autoComplete="username"
                className="h-9 rounded-md border border-white/15 bg-slate-950/55 px-2 text-xs text-slate-100 outline-none focus:border-cyan-300/40"
                placeholder={UI_TEXT.dnse.usernamePlaceholder}
              />
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="current-password"
                className="h-9 rounded-md border border-white/15 bg-slate-950/55 px-2 text-xs text-slate-100 outline-none focus:border-cyan-300/40"
                placeholder={UI_TEXT.dnse.passwordPlaceholder}
              />
            </div>
          </div>

          <label className="block text-xs text-slate-300">
            {UI_TEXT.dnse.otp}
            <div className="mt-1 flex flex-wrap gap-2">
              <input
                type="password"
                value={otp}
                onChange={(event) => setOtp(event.target.value)}
                autoComplete="one-time-code"
                className="h-10 min-w-[160px] flex-1 rounded-md border border-white/20 bg-slate-950/45 px-3 text-sm text-slate-100 outline-none focus:border-cyan-300/50"
                placeholder="OTP / Smart OTP"
              />
              <button
                type="button"
                onClick={() => void handleRequestOtp()}
                disabled={otpSending}
                className="h-10 rounded-md border border-white/25 bg-slate-900/60 px-3 text-xs font-medium text-slate-200 hover:bg-slate-800/80 disabled:opacity-50"
              >
                {otpSending ? UI_TEXT.dnse.sendingOtp : UI_TEXT.dnse.requestEmailOtp}
              </button>
            </div>
          </label>

          <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-300">
            <input
              type="checkbox"
              checked={smartOtp}
              onChange={(event) => setSmartOtp(event.target.checked)}
              className="rounded border-white/30 bg-slate-950"
            />
            {UI_TEXT.dnse.smartOtp}
          </label>

          <button
            type="submit"
            disabled={submitting}
            className="h-11 w-full rounded-md bg-gradient-to-r from-cyan-600/90 to-emerald-700/90 text-sm font-semibold text-white shadow-lg shadow-cyan-900/30 hover:from-cyan-500 hover:to-emerald-600 disabled:opacity-50 sm:w-auto sm:px-8"
          >
            {submitting ? UI_TEXT.dnse.placing : UI_TEXT.dnse.placeOrder}
          </button>
        </form>
      ) : null}
    </section>
  );
}
