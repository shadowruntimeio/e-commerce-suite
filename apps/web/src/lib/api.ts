import axios from 'axios'
import { useAuthStore } from '../store/auth.store'

// In production (Vercel), VITE_API_URL points to the Railway API
// In dev, requests go through Vite proxy to localhost:3001
const baseURL = import.meta.env.VITE_API_URL
  ? `${import.meta.env.VITE_API_URL}/api/v1`
  : '/api/v1'

export const api = axios.create({
  baseURL,
  headers: { 'Content-Type': 'application/json' },
})

api.interceptors.request.use((config) => {
  const token = useAuthStore.getState().accessToken
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

api.interceptors.response.use(
  (res) => res,
  async (error) => {
    const original = error.config
    if (error.response?.status === 401 && !original._retry) {
      original._retry = true
      try {
        const refreshToken = useAuthStore.getState().refreshToken
        const res = await axios.post('/api/v1/auth/refresh', { refreshToken })
        useAuthStore.getState().setTokens(res.data.data.accessToken, res.data.data.refreshToken)
        original.headers.Authorization = `Bearer ${res.data.data.accessToken}`
        return api(original)
      } catch {
        useAuthStore.getState().logout()
        window.location.href = '/auth/login'
      }
    }
    return Promise.reject(error)
  }
)
