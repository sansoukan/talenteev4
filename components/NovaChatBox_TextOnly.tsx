"use client"

import { forwardRef, useImperativeHandle, useState, useRef } from "react"

export interface NovaChatBoxTextOnlyRef {
  addMessage: (sender: string, message: string) => void
  getLastQuestion: () => string | null
}

const NovaChatBox_TextOnly = forwardRef<NovaChatBoxTextOnlyRef, { onUserMessage: (msg: string) => void }>(
  ({ onUserMessage }, ref) => {
    const [messages, setMessages] = useState<Array<{ sender: string; text: string }>>([])
    const [inputValue, setInputValue] = useState("")
    const inputRef = useRef<HTMLInputElement>(null)

    useImperativeHandle(ref, () => ({
      addMessage: (sender, message) => {
        setMessages((prev) => [...prev, { sender, text: message }])
      },
      getLastQuestion: () => messages[messages.length - 1]?.text || null,
    }))

    const handleSend = () => {
      if (!inputValue.trim()) return
      onUserMessage(inputValue)
      setMessages((prev) => [...prev, { sender: "user", text: inputValue }])
      setInputValue("")
    }

    return (
      <div className="flex flex-col h-full">
        {/* Messages area */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4 scrollbar-thin scrollbar-thumb-white/20 scrollbar-track-transparent">
          {messages.length === 0 && (
            <div className="flex items-center justify-center h-full">
              <p className="text-white/50 text-sm font-medium">Messages will appear here...</p>
            </div>
          )}
          {messages.map((msg, i) => (
            <div key={i} className={`flex ${msg.sender === "user" ? "justify-end" : "justify-start"}`}>
              <div
                className={`max-w-[85%] px-4 py-3 shadow-lg ${
                  msg.sender === "nova"
                    ? "bg-gradient-to-br from-white/15 to-white/5 backdrop-blur-xl text-white rounded-2xl rounded-bl-md border border-white/10"
                    : "bg-gradient-to-br from-cyan-500 to-blue-600 text-white font-medium rounded-2xl rounded-br-md"
                }`}
              >
                <div className="text-sm leading-relaxed">{msg.text}</div>
              </div>
            </div>
          ))}
        </div>

        {/* Input area - Apple style */}
        <div className="p-4 border-t border-white/10 bg-black/30">
          <div className="flex items-center gap-3 bg-white/10 backdrop-blur-xl rounded-full px-5 py-3 border border-white/15 focus-within:border-white/30 focus-within:bg-white/15 transition-all duration-200">
            <input
              ref={inputRef}
              type="text"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              placeholder="Type a message..."
              className="flex-1 bg-transparent text-white text-sm placeholder:text-white/40 focus:outline-none font-medium"
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault()
                  handleSend()
                }
              }}
            />
            {/* Send button - Apple style arrow */}
            <button
              onClick={handleSend}
              disabled={!inputValue.trim()}
              className={`w-9 h-9 rounded-full flex items-center justify-center transition-all duration-200 ${
                inputValue.trim()
                  ? "bg-gradient-to-br from-cyan-500 to-blue-600 text-white hover:opacity-90 hover:scale-105 active:scale-95 shadow-lg shadow-cyan-500/30"
                  : "bg-white/10 text-white/30 cursor-not-allowed"
              }`}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 10.5L12 3m0 0l7.5 7.5M12 3v18" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    )
  },
)

NovaChatBox_TextOnly.displayName = "NovaChatBox_TextOnly"

export default NovaChatBox_TextOnly
