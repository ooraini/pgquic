package observability

import "github.com/prometheus/client_golang/prometheus"

type Metrics struct {
	Sessions                                prometheus.Gauge
	Streams                                 prometheus.Gauge
	SessionsTotal, Rejected, UpstreamErrors prometheus.Counter
}

func New(reg prometheus.Registerer) *Metrics {
	m := &Metrics{Sessions: prometheus.NewGauge(prometheus.GaugeOpts{Name: "pgquic_active_sessions", Help: "Active WebTransport sessions."}), Streams: prometheus.NewGauge(prometheus.GaugeOpts{Name: "pgquic_active_streams", Help: "Active PostgreSQL streams."}), SessionsTotal: prometheus.NewCounter(prometheus.CounterOpts{Name: "pgquic_sessions_total", Help: "Accepted WebTransport sessions."}), Rejected: prometheus.NewCounter(prometheus.CounterOpts{Name: "pgquic_rejected_total", Help: "Rejected requests or streams."}), UpstreamErrors: prometheus.NewCounter(prometheus.CounterOpts{Name: "pgquic_upstream_errors_total", Help: "PostgreSQL upstream failures."})}
	reg.MustRegister(m.Sessions, m.Streams, m.SessionsTotal, m.Rejected, m.UpstreamErrors)
	return m
}
