"use client";

import { useEffect, useState, useMemo } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import NovaEngine_Playlist from "@/components/NovaEngine_Playlist";
import { supabase } from "@/lib/supabaseClient";
import { getClientUser, signOutClient } from "@/lib/auth";
import { novaPrices } from "@/lib/novaPrices";
import PremiumPopup from "@/components/PremiumPopup";
import NovaToast from "@/components/NovaToast";

/* ======================================================
 🎯 Durée des simulations
====================================================== */
const DURATION_MAP: Record<string, number> = {
  internship: 1200,
  job_interview: 1200,
  case_study: 1200,
  promotion: 900,
  annual_review: 900,
  goal_setting: 900,
  practice: 900,
  strategic_case: 1200,
};

export default function SessionPage() {
  const router = useRouter();
  const sp = useSearchParams();

  const [ready, setReady] = useState(false);
  const [user, setUser] = useState<any>(null);
  const [showPremium, setShowPremium] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [type, setType] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [alertPlayed, setAlertPlayed] = useState(false);
  const [sessionStatus, setSessionStatus] = useState<string | null>(null);

  const sid = sp.get("session_id");
  const activeId = useMemo(() => sid || sessionId, [sid, sessionId]);
  const durationSec = useMemo(() => (type ? DURATION_MAP[type] : 1200), [type]);
  const alertDelayMs = (durationSec - 120) * 1000;

  /* ======================================================
  1️⃣ AUTH STABLE — VERSION STRIPE-SAFE
  ====================================================== */
  useEffect(() => {
    let isMounted = true;

    async function restoreUser() {
      console.log("🔐 [AUTH] Vérification utilisateur… sid =", sid);

      // 1. Si on revient de Stripe → attendre un peu pour que Supabase recolle les cookies
      if (sid) {
        console.log("⏳ Retour Stripe → attente 1.2s avant check");
        await new Promise((res) => setTimeout(res, 1200));
      }

      // 2. Premier essai
      let session = await supabase.auth.getSession();
      if (session?.data?.session?.user) {
        console.log("🟢 [AUTH] User trouvé (first try):", session.data.session.user.id);
        setUser(session.data.session.user);
        setReady(true);
        return;
      }

      // 3. Multi-retry (Stripe-safe)
      for (let i = 0; i < 5; i++) {
        console.log(`🔄 [AUTH] Retry #${i + 1}…`);
        await new Promise((res) => setTimeout(res, 800));

        let sess = await supabase.auth.getSession();
        if (sess?.data?.session?.user) {
          console.log("🟢 [AUTH] User restauré après retry:", sess.data.session.user.id);
          setUser(sess.data.session.user);
          setReady(true);
          return;
        }
      }

      // 4. Si on arrive de Stripe → ne pas rediriger
      if (sid) {
        console.log("🟡 [AUTH] Aucun user MAIS Stripe flow → ready = true");
        setReady(true);
        return;
      }

      // 5. Cas normal : pas connecté → redirection
      console.log("🔴 [AUTH] Aucun user → redirection login");
      router.replace("/auth?next=/session");
    }

    restoreUser();
    return () => {
      isMounted = false;
    };
  }, [sid, router]);

  /* ======================================================
  2️⃣ Polling Stripe : pending → paid
  ====================================================== */
  useEffect(() => {
    if (!sid) return;

    console.log("💳 [STRIPE] Start polling for session:", sid);

    let attempts = 0;

    const checkStatus = async () => {
      const { data, error } = await supabase
        .from("nova_sessions")
        .select("status")
        .eq("id", sid)
        .maybeSingle();

      if (error) {
        console.log("⚠️ Supabase error:", error.message);
        return;
      }

      const status = data?.status || "unknown";
      console.log(`[STRIPE] Poll #${attempts + 1} →`, status);
      setSessionStatus(status);

      if (["paid", "active", "started"].includes(status)) {
        console.log("🟢 Payment confirmed → launching nova");
        router.replace(`/session?session_id=${sid}`);
        return;
      }

      if (attempts < 20) {
        attempts++;
        setTimeout(checkStatus, 1500);
      } else {
        console.log("⛔ Stripe timeout → return dashboard");
        router.push("/dashboard");
      }
    };

    checkStatus();
  }, [sid, router]);

  /* ======================================================
  3️⃣ Alerte vocale T-2 minutes
  ====================================================== */
  useEffect(() => {
    if (!activeId) return;

    const timer = setTimeout(() => {
      if (!alertPlayed) {
        const msg = new SpeechSynthesisUtterance("You have two minutes remaining.");
        msg.lang = "en-US";
        window.speechSynthesis.speak(msg);
        setAlertPlayed(true);
      }
    }, alertDelayMs);

    return () => clearTimeout(timer);
  }, [activeId, alertDelayMs, alertPlayed]);

  /* ======================================================
  4️⃣ Créer session Nova
  ====================================================== */
  async function startSimulation(selectedType: string) {
    setLoading(true);
    setErrorMsg(null);

    try {
      const { data: profile } = await supabase
        .from("profiles")
        .select("id, career_stage, domain, goal")
        .eq("id", user.id)
        .single();

      if (!profile) {
        router.push("/onboarding");
        return;
      }

      const payload = {
        user_id: profile.id,
        option: selectedType,
        domain: profile.domain,
        goal: profile.goal,
        career_stage: profile.career_stage,
        duration_limit: DURATION_MAP[selectedType],
      };

      const res = await fetch("/api/engine/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const json = await res.json();

      if (json?.url) {
        window.location.href = json.url;
        return;
      }

      if (json?.bypass || json?.mock) {
        router.push(`/session?session_id=${json.session_id}`);
        return;
      }

      if (json?.require_cv) {
        setShowPremium(true);
        return;
      }

      setSessionId(json.session_id);
    } catch (e) {
      setErrorMsg("Server error");
    } finally {
      setLoading(false);
    }
  }

  /* ======================================================
  5️⃣ Cas de garde
  ====================================================== */
  if (!ready) {
    return (
      <main className="flex items-center justify-center h-screen bg-black text-white">
        <div className="animate-pulse text-center">Nova is preparing your simulation…</div>
      </main>
    );
  }

  if (
    activeId &&
    (!activeId.match(/^[0-9a-fA-F-]{36}$/) || activeId === "[object Object]")
  ) {
    return (
      <main className="flex items-center justify-center h-screen bg-black text-white">
        <div className="text-center">
          <h1 className="text-red-500 text-xl">Invalid session ID</h1>
        </div>
      </main>
    );
  }

  if (sid && sessionStatus === "pending") {
    return (
      <main className="flex items-center justify-center h-screen bg-black text-white">
        <div className="animate-pulse text-center">
          Payment pending… Please wait.
        </div>
      </main>
    );
  }

  /* ======================================================
  6️⃣ Start engine
  ====================================================== */
  if (activeId) {
    return (
      <main className="relative min-h-screen bg-black text-white flex items-center justify-center">
        <NovaEngine_Playlist sessionId={activeId} />
        <NovaToast />
      </main>
    );
  }

  /* ======================================================
  7️⃣ Page de sélection
  ====================================================== */
  return (
    <main className="min-h-screen bg-black text-white p-10 flex flex-col gap-8">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-blue-400">Nova Simulation</h1>
          <p className="text-gray-400 text-sm">{user?.email}</p>
        </div>
        <button
          onClick={signOutClient}
          className="text-sm bg-gray-800 px-4 py-2 rounded-lg hover:bg-gray-700"
        >
          Sign out
        </button>
      </div>

      <div className="bg-gray-800/60 p-6 rounded-xl border border-white/10">
        <p className="text-lg font-semibold text-white">Choose your interview type:</p>
        <p className="text-gray-400 text-sm mt-1">
          Each session lasts between 15–20 minutes. Full feedback included.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-6">
        {Object.entries(DURATION_MAP).map(([key, dur]) => (
          <div
            key={key}
            onClick={() => setType(key)}
            className={`p-6 rounded-xl border cursor-pointer transition ${
              type === key
                ? "border-blue-500 bg-blue-500/10"
                : "border-gray-700 bg-gray-900/40 hover:border-blue-400/50"
            }`}
          >
            <p className="text-white text-lg capitalize">{key.replace("_", " ")}</p>
            <p className="text-gray-400 text-sm mt-2">
              Duration: {Math.floor(dur / 60)} min
            </p>
            <p className="text-blue-400 font-semibold mt-1">
              ${novaPrices.find((p) => p.id === key)?.price.toFixed(2)}
            </p>
          </div>
        ))}
      </div>

      {errorMsg && <p className="text-red-400">{errorMsg}</p>}

      <div className="flex justify-end mt-4">
        <button
          disabled={!type || loading}
          onClick={() => startSimulation(type!)}
          className={`px-6 py-3 rounded-lg ${
            type
              ? "bg-blue-600 hover:bg-blue-500 text-white"
              : "bg-gray-700 text-gray-400 cursor-not-allowed"
          }`}
        >
          {loading ? "Starting…" : "Start simulation"}
        </button>
      </div>

      {showPremium && <PremiumPopup onClose={() => setShowPremium(false)} />}
      <NovaToast />
    </main>
  );
}
