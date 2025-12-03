import { NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabaseAdmin"

export async function POST(req: Request) {
  try {
    const { session_id } = await req.json()

    if (!session_id) {
      return NextResponse.json({ error: "Missing session_id" }, { status: 400 })
    }

    // Charger la session
    const { data: session } = await supabaseAdmin
      .from("nova_sessions")
      .select("*")
      .eq("id", session_id)
      .maybeSingle()

    if (!session) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 })
    }

    const user_id = session.user_id

    // 1. Reset mémoire questions
    await supabaseAdmin.from("nova_memory").delete().eq("user_id", user_id)

    // 2. Reset INIT_Q1 + intros
    const newDetail = {
      ...(session.detail || {}),
      init_q1_sent: false,
      intro1_played: false,
      intro2_played: false,
    }

    await supabaseAdmin
      .from("nova_sessions")
      .update({ detail: newDetail })
      .eq("id", session_id)

    return NextResponse.json({
      ok: true,
      detail: newDetail,
    })
  } catch (err: any) {
    console.error("[reload-start-profile] FATAL:", err)
    return NextResponse.json(
      { error: err?.message || "Server error" },
      { status: 500 },
    )
  }
}