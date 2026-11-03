import { useEffect, useState } from 'react'

const pad = (n) => String(n).padStart(2, '0')

function useUtcClock() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(id)
  }, [])
  return `${pad(now.getUTCHours())}:${pad(now.getUTCMinutes())}:${pad(now.getUTCSeconds())}`
}

export default function Header() {
  const clock = useUtcClock()
  return (
    <header className="header">
      <h1 className="header__prompt">
        <span className="prompt-user">lasco_test@soho</span>
        <span className="prompt-sep">:</span>
        <span className="prompt-path">~</span>
        <span className="prompt-sep">$</span> ./panel --mision soho --instrumento lasco
        <span className="cursor" aria-hidden="true" />
      </h1>
      <div className="header__clock" aria-label="Hora UTC actual">
        utc {clock}
      </div>
    </header>
  )
}
