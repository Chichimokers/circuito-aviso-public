import { useEffect, useRef, useState } from 'react'
import { EVENT_STREAM_URL } from '../api.js'

export function useRealtime(onEvent) {
  const [connected, setConnected] = useState(false)
  const cbRef = useRef(onEvent)
  cbRef.current = onEvent

  useEffect(() => {
    let retry = 0
    let es

    function connect() {
      es = new EventSource(EVENT_STREAM_URL)
      es.onopen = () => {
        setConnected(true)
        retry = 0
      }
      es.onmessage = (ev) => {
        try {
          cbRef.current(JSON.parse(ev.data))
        } catch (e) {}
      }
      es.onerror = () => {
        setConnected(false)
        es.close()
        retry = Math.min(retry + 1, 10)
        setTimeout(connect, 2000 * Math.pow(1.5, retry))
      }
    }

    connect()
    return () => {
      setConnected(false)
      if (es) es.close()
    }
  }, [])

  return connected
}
