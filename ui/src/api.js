import axios from 'axios'

const http = axios.create({ baseURL: '/api' })

export const endpointsAPI = {
  list:         ()        => http.get('/endpoints'),
  create:       (data)    => http.post('/endpoints', data),
  update:       (id, d)   => http.patch(`/endpoints/${id}`, d),
  remove:       (id)      => http.delete(`/endpoints/${id}`),
  logs:         (id, p)   => http.get(`/endpoints/${id}/logs`, { params: p }),
  rotateSecret: (id)      => http.post(`/endpoints/${id}/rotate-secret`),
}

export const eventsAPI = {
  trigger:  (data) => http.post('/events/trigger', data),
  types:    ()     => http.get('/events/types'),
}

export const deliveriesAPI = {
  stats:      ()     => http.get('/deliveries/stats'),
  deadLetter: (p)    => http.get('/deliveries/dead-letter', { params: p }),
  retry:      (id)   => http.post(`/deliveries/${id}/retry`),
}