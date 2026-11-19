// Package reading owns shared reading transactions; it has no HTTP or generated DTO dependencies.
package reading

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"math"
	"regexp"
	"strconv"
	"time"
	"unicode/utf8"

	"reichard.io/antholume/database"
)

const MaxRevision int64 = 999999999999999999

var revisionPattern = regexp.MustCompile(`^(0|[1-9][0-9]{0,17})$`)

type Store struct{ DB *sql.DB }
type State struct {
	DocumentID       string
	Revision         string
	Position         *string
	Fraction         *float64
	DeviceID         *string
	UpdatedAt        *string
	ExternalDeviceID *string
	DeviceName       string
}
type Progress struct {
	EventID      string    `json:"event_id"`
	DocumentID   string    `json:"document_id"`
	DeviceID     string    `json:"device_id"`
	ObservedAt   time.Time `json:"observed_at"`
	BaseRevision string    `json:"base_revision"`
	Position     string    `json:"position"`
	Fraction     float64   `json:"fraction"`
}
type Activity struct {
	EventID       string    `json:"event_id"`
	DocumentID    string    `json:"document_id"`
	DeviceID      string    `json:"device_id"`
	StartTime     time.Time `json:"start_time"`
	Duration      int       `json:"duration"`
	StartFraction float64   `json:"start_fraction"`
	EndFraction   float64   `json:"end_fraction"`
}
type Decision struct {
	Status          int
	EventID         string
	Kind            string
	Revision        *string
	Code            string
	CurrentRevision *string
}
type Failure struct {
	Status int
	Code   string
}

func (f *Failure) Error() string         { return f.Code }
func fail(status int, code string) error { return &Failure{status, code} }
func validID(s string) bool {
	return utf8.ValidString(s) && utf8.RuneCountInString(s) >= 1 && utf8.RuneCountInString(s) <= 128
}
func fraction(f float64) bool { return !math.IsNaN(f) && !math.IsInf(f, 0) && f >= 0 && f <= 1 }
func zero(f float64) float64 {
	if f == 0 {
		return 0
	}
	return f
}

type accountIDKey struct{}

// WithAccountID binds web operations to the account instance selected at authentication.
func WithAccountID(ctx context.Context, id string) context.Context {
	return context.WithValue(ctx, accountIDKey{}, id)
}

func account(ctx context.Context, tx *sql.Tx, user string) error {
	query, args := "SELECT count(*) FROM users WHERE id=?", []any{user}
	if id, ok := ctx.Value(accountIDKey{}).(string); ok {
		query, args = "SELECT count(*) FROM account_identities WHERE user_id=? AND account_id=?", []any{user, id}
	}
	var n int
	if err := tx.QueryRowContext(ctx, query, args...).Scan(&n); err != nil {
		return err
	}
	if n != 1 {
		return fail(401, "unauthenticated")
	}
	return nil
}
func live(ctx context.Context, tx *sql.Tx, document string) error {
	var n int
	if err := tx.QueryRowContext(ctx, "SELECT count(*) FROM documents WHERE id=? AND deleted=0", document).Scan(&n); err != nil {
		return err
	}
	if n != 1 {
		return fail(404, "not_found")
	}
	return nil
}
func owned(ctx context.Context, tx *sql.Tx, user, device string) error {
	var owner string
	err := tx.QueryRowContext(ctx, "SELECT user_id FROM devices WHERE id=?", device).Scan(&owner)
	if errors.Is(err, sql.ErrNoRows) {
		return fail(403, "forbidden")
	}
	if err != nil {
		return err
	}
	if owner != user {
		return fail(409, "device_conflict")
	}
	return nil
}
func register(ctx context.Context, tx *sql.Tx, user, id, name string) error {
	if !validID(id) || !utf8.ValidString(name) || utf8.RuneCountInString(name) > 128 {
		return fail(400, "invalid_request")
	}
	var owner string
	err := tx.QueryRowContext(ctx, "SELECT user_id FROM devices WHERE id=?", id).Scan(&owner)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return err
	}
	if err == nil && owner != user {
		return fail(409, "device_conflict")
	}
	_, err = tx.ExecContext(ctx, `INSERT INTO devices(id,user_id,device_name) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET device_name=excluded.device_name,last_synced=STRFTIME('%Y-%m-%dT%H:%M:%SZ','now')`, id, user, name)
	return err
}
func (s *Store) RegisterDevice(ctx context.Context, user, id, name string) error {
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if err = account(ctx, tx, user); err == nil {
		err = register(ctx, tx, user, id, name)
	}
	if err != nil {
		return err
	}
	return tx.Commit()
}
func state(ctx context.Context, tx *sql.Tx, user, document string) (State, error) {
	out := State{DocumentID: document, Revision: "0"}
	err := tx.QueryRowContext(ctx, `SELECT CAST(h.revision AS TEXT),h.position,h.fraction,h.device_id,h.updated_at,
 CASE WHEN s.user_id IS NOT NULL THEN s.external_id ELSE h.device_id END,COALESCE(s.device_name,d.device_name,'')
 FROM reading_heads h LEFT JOIN reading_head_devices s ON s.user_id=h.user_id AND s.document_id=h.document_id
 LEFT JOIN devices d ON d.id=h.device_id WHERE h.user_id=? AND h.document_id=?`, user, document).Scan(&out.Revision, &out.Position, &out.Fraction, &out.DeviceID, &out.UpdatedAt, &out.ExternalDeviceID, &out.DeviceName)
	if errors.Is(err, sql.ErrNoRows) {
		err = nil
	}
	return out, err
}
func (s *Store) State(ctx context.Context, user, document string) (State, error) {
	tx, err := s.DB.BeginTx(ctx, &sql.TxOptions{ReadOnly: true})
	if err != nil {
		return State{}, err
	}
	defer tx.Rollback()
	if err = account(ctx, tx, user); err != nil {
		return State{}, err
	}
	if err = live(ctx, tx, document); err != nil {
		return State{}, err
	}
	out, err := state(ctx, tx, user, document)
	if err != nil {
		return out, err
	}
	return out, tx.Commit()
}
func (s *Store) apply(ctx context.Context, user, event, document, device, kind, observed string, payload any, effect func(*sql.Tx) (Decision, error)) (Decision, error) {
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return Decision{}, err
	}
	defer tx.Rollback()
	if err = account(ctx, tx, user); err != nil {
		return Decision{}, err
	}
	normalized, err := json.Marshal(payload)
	if err != nil {
		return Decision{}, err
	}
	sum := sha256.Sum256(append([]byte("v1:"+kind+":"), normalized...))
	digest := hex.EncodeToString(sum[:])
	out := Decision{EventID: event, Kind: kind}
	var old string
	err = tx.QueryRowContext(ctx, `SELECT digest,status,revision,code,current_revision FROM reading_receipts WHERE user_id=? AND event_id=?`, user, event).Scan(&old, &out.Status, &out.Revision, &out.Code, &out.CurrentRevision)
	if err == nil {
		if old != digest {
			return Decision{}, fail(409, "idempotency_conflict")
		}
		return out, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return Decision{}, err
	}
	if err = live(ctx, tx, document); err != nil {
		return Decision{}, err
	}
	if err = owned(ctx, tx, user, device); err != nil {
		return Decision{}, err
	}
	out, err = effect(tx)
	if err != nil {
		return Decision{}, err
	}
	out.EventID = event
	out.Kind = kind
	_, err = tx.ExecContext(ctx, `INSERT INTO reading_receipts(user_id,event_id,document_id,kind,payload_version,payload,digest,observed_at,status,revision,code,current_revision) VALUES(?,?,?,?,1,?,?,?,?,?,?,?)`, user, event, document, kind, string(normalized), digest, observed, out.Status, out.Revision, out.Code, out.CurrentRevision)
	if err != nil {
		return Decision{}, err
	}
	if err = tx.Commit(); err != nil {
		return Decision{}, err
	}
	return out, nil
}

type deviceSnapshot struct {
	ExternalID *string
	Name       string
}

func advance(ctx context.Context, tx *sql.Tx, user, document, device, position string, f float64, base *string, snapshot *deviceSnapshot) (Decision, error) {
	head, err := state(ctx, tx, user, document)
	if err != nil {
		return Decision{}, err
	}
	if base != nil && head.Revision != *base {
		return Decision{Status: 409, Code: "progress_conflict", CurrentRevision: &head.Revision}, nil
	}
	n, err := strconv.ParseInt(head.Revision, 10, 64)
	if err != nil {
		return Decision{}, err
	}
	if n == MaxRevision {
		return Decision{Status: 409, Code: "revision_exhausted", CurrentRevision: &head.Revision}, nil
	}
	if snapshot == nil {
		snapshot = &deviceSnapshot{ExternalID: &device}
		if err := tx.QueryRowContext(ctx, "SELECT device_name FROM devices WHERE id=?", device).Scan(&snapshot.Name); err != nil {
			return Decision{}, err
		}
	} else if snapshot.ExternalID == nil {
		// Optional Field - Upstream HSET leaves an already stored device_id intact when the next write omits it.
		snapshot.ExternalID = head.ExternalDeviceID
	}
	next := strconv.FormatInt(n+1, 10)
	// Accepted State - Server arrival advances the shared revision; observation time and fraction never select a winner.
	updated := time.Now().UTC().Format(time.RFC3339)
	_, err = tx.ExecContext(ctx, `INSERT INTO reading_heads(user_id,document_id,revision,position,fraction,device_id,updated_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(user_id,document_id) DO UPDATE SET revision=excluded.revision,position=excluded.position,fraction=excluded.fraction,device_id=excluded.device_id,updated_at=excluded.updated_at`, user, document, n+1, position, f, device, updated)
	if err != nil {
		return Decision{}, err
	}
	_, err = tx.ExecContext(ctx, `INSERT INTO reading_head_devices(user_id,document_id,external_id,device_name) VALUES(?,?,?,?)
 ON CONFLICT(user_id,document_id) DO UPDATE SET external_id=excluded.external_id,device_name=excluded.device_name`, user, document, snapshot.ExternalID, snapshot.Name)
	if err != nil {
		return Decision{}, err
	}
	_, err = database.New(tx).UpdateProgress(ctx, database.UpdateProgressParams{UserID: user, DocumentID: document, DeviceID: device, Percentage: f, Progress: position})
	return Decision{Status: 200, Revision: &next}, err
}
func (s *Store) Progress(ctx context.Context, user string, e Progress) (Decision, error) {
	if !validID(e.DocumentID) || !validID(e.DeviceID) || !validID(e.EventID) || !revisionPattern.MatchString(e.BaseRevision) || !fraction(e.Fraction) || !utf8.ValidString(e.Position) || utf8.RuneCountInString(e.Position) < 1 || utf8.RuneCountInString(e.Position) > 4096 || e.ObservedAt.IsZero() {
		return Decision{}, fail(400, "invalid_request")
	}
	e.ObservedAt = e.ObservedAt.UTC()
	e.Fraction = zero(e.Fraction)
	return s.apply(ctx, user, e.EventID, e.DocumentID, e.DeviceID, "progress", e.ObservedAt.Format(time.RFC3339Nano), e, func(tx *sql.Tx) (Decision, error) {
		return advance(ctx, tx, user, e.DocumentID, e.DeviceID, e.Position, e.Fraction, &e.BaseRevision, nil)
	})
}
func credit(ctx context.Context, tx *sql.Tx, user string, e Activity) error {
	if !validID(e.DocumentID) || !validID(e.DeviceID) || !fraction(e.StartFraction) || !fraction(e.EndFraction) || e.StartFraction > e.EndFraction || e.Duration < 0 || e.Duration > 86400 || e.StartTime.IsZero() {
		return fail(400, "invalid_request")
	}
	_, err := tx.ExecContext(ctx, `INSERT INTO activity(user_id,document_id,device_id,start_time,duration,start_percentage,end_percentage) VALUES(?,?,?,?,?,?,?)`, user, e.DocumentID, e.DeviceID, e.StartTime.UTC().Format(time.RFC3339Nano), e.Duration, e.StartFraction, e.EndFraction)
	return err
}
func (s *Store) Activity(ctx context.Context, user string, e Activity) (Decision, error) {
	e.StartTime = e.StartTime.UTC()
	e.StartFraction = zero(e.StartFraction)
	e.EndFraction = zero(e.EndFraction)
	if !validID(e.EventID) {
		return Decision{}, fail(400, "invalid_request")
	}
	return s.apply(ctx, user, e.EventID, e.DocumentID, e.DeviceID, "activity", e.StartTime.Format(time.RFC3339Nano), e, func(tx *sql.Tx) (Decision, error) { err := credit(ctx, tx, user, e); return Decision{Status: 200}, err })
}

// KOProgress resolves external identity in the same transaction as the shared head and per-device row.
func (s *Store) KOProgress(ctx context.Context, user, document string, externalID *string, name, position string, f float64) (string, error) {
	if !validID(document) || !fraction(f) || !utf8.ValidString(position) || utf8.RuneCountInString(position) > 4096 {
		return "", fail(400, "invalid_request")
	}
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return "", err
	}
	defer tx.Rollback()
	if err = account(ctx, tx, user); err != nil {
		return "", err
	}
	device, err := koDevice(ctx, tx, user, externalID, name)
	if err != nil {
		return "", err
	}
	_, err = tx.ExecContext(ctx, "INSERT OR IGNORE INTO documents(id) VALUES(?)", document)
	if err != nil {
		return "", err
	}
	if err = live(ctx, tx, document); err != nil {
		return "", err
	}
	out, err := advance(ctx, tx, user, document, device, position, f, nil, &deviceSnapshot{ExternalID: externalID, Name: name})
	if err != nil {
		return "", err
	}
	if out.Status != 200 {
		return "", fail(out.Status, out.Code)
	}
	var timestamp string
	if err = tx.QueryRowContext(ctx, "SELECT updated_at FROM reading_heads WHERE user_id=? AND document_id=?", user, document).Scan(&timestamp); err != nil {
		return "", err
	}
	return timestamp, tx.Commit()
}
func (s *Store) KOActivity(ctx context.Context, user, device, name string, events []Activity) error {
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if err = account(ctx, tx, user); err == nil {
		err = register(ctx, tx, user, device, name)
	}
	if err != nil {
		return err
	}
	for _, e := range events {
		e.DeviceID = device
		if _, err = tx.ExecContext(ctx, "INSERT OR IGNORE INTO documents(id) VALUES(?)", e.DocumentID); err != nil {
			return err
		}
		// SyncNinja Cursor - Historical activity advances the device cursor even when the book is no longer in the catalog.
		if err = credit(ctx, tx, user, e); err != nil {
			return err
		}
	}
	return tx.Commit()
}
