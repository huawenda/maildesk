import { useEffect, useState } from "react"
import { MessageList } from "@/components/MessageList"
import { Reader } from "@/components/Reader"
import { Sidebar } from "@/components/Sidebar"
import { TitleBar } from "@/components/TitleBar"
import { messages } from "@/lib/mock"
import { useThemeMode } from "@/lib/theme"

export default function App() {
  const { mode, setMode } = useThemeMode()
  const [selectedId, setSelectedId] = useState<string | null>(messages[0]?.id ?? null)
  const [version, setVersion] = useState<string>()

  useEffect(() => {
    window.mail.app
      .getInfo()
      .then((info) => setVersion(info.version))
      .catch(() => setVersion(undefined))
  }, [])

  const selected = messages.find((message) => message.id === selectedId) ?? null

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background text-foreground">
      <TitleBar />
      <div className="flex min-h-0 flex-1">
        <Sidebar mode={mode} onModeChange={setMode} version={version} />
        <MessageList messages={messages} selectedId={selectedId} onSelect={setSelectedId} />
        <Reader message={selected} />
      </div>
    </div>
  )
}
