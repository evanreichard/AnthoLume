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

func account(ctx context.Context, q *database.Queries, user string) error {
	var n int64
	var err error
	if id, ok := ctx.Value(accountIDKey{}).(string); ok {
		n, err = q.CountAccountIdentities(ctx, database.CountAccountIdentitiesParams{UserID: user, AccountID: id})
	} else {
		n, err = q.CountUsersByID(ctx, user)
	}
	if err != nil {
		return err
	}
	if n != 1 {
		return fail(401, "unauthenticated")
	}
	return nil
}
func live(ctx context.Context, q *database.Queries, document string) error {
	n, err := q.CountLiveDocuments(ctx, document)
	if err != nil {
		return err
	}
	if n != 1 {
		return fail(404, "not_found")
	}
	return nil
}
func owned(ctx context.Context, q *database.Queries, user, device string) error {
	owner, err := q.GetDeviceOwner(ctx, device)
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
func register(ctx context.Context, q *database.Queries, user, id, name string) error {
	if !validID(id) || !utf8.ValidString(name) || utf8.RuneCountInString(name) > 128 {
		return fail(400, "invalid_request")
	}
	owner, err := q.GetDeviceOwner(ctx, id)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return err
	}
	if err == nil && owner != user {
		return fail(409, "device_conflict")
	}
	return q.RegisterReadingDevice(ctx, database.RegisterReadingDeviceParams{ID: id, UserID: user, DeviceName: name})
}
func (s *Store) RegisterDevice(ctx context.Context, user, id, name string) error {
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	q := database.New(tx)
	if err = account(ctx, q, user); err == nil {
		err = register(ctx, q, user, id, name)
	}
	if err != nil {
		return err
	}
	return tx.Commit()
}
func state(ctx context.Context, q *database.Queries, user, document string) (State, error) {
	head, err := q.GetReadingHead(ctx, database.GetReadingHeadParams{UserID: user, DocumentID: document})
	if errors.Is(err, sql.ErrNoRows) {
		return State{DocumentID: document, Revision: "0"}, nil
	}
	revision := head.Revision
	if err != nil && revision == "" {
		revision = "0"
	}
	// An existing snapshot may deliberately omit the external ID.
	externalID := head.ExternalDeviceID
	if err == nil && !head.HasDeviceSnapshot && head.DeviceID != nil {
		id := *head.DeviceID
		externalID = &id
	}
	return State{
		DocumentID:       document,
		Revision:         revision,
		Position:         head.Position,
		Fraction:         head.Fraction,
		DeviceID:         head.DeviceID,
		UpdatedAt:        head.UpdatedAt,
		ExternalDeviceID: externalID,
		DeviceName:       head.DeviceName,
	}, err
}
func (s *Store) State(ctx context.Context, user, document string) (State, error) {
	tx, err := s.DB.BeginTx(ctx, &sql.TxOptions{ReadOnly: true})
	if err != nil {
		return State{}, err
	}
	defer tx.Rollback()
	q := database.New(tx)
	if err = account(ctx, q, user); err != nil {
		return State{}, err
	}
	if err = live(ctx, q, document); err != nil {
		return State{}, err
	}
	out, err := state(ctx, q, user, document)
	if err != nil {
		return out, err
	}
	return out, tx.Commit()
}
func (s *Store) apply(ctx context.Context, user, event, document, device, kind, observed string, payload any, effect func(*database.Queries) (Decision, error)) (Decision, error) {
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return Decision{}, err
	}
	defer tx.Rollback()
	q := database.New(tx)
	if err = account(ctx, q, user); err != nil {
		return Decision{}, err
	}
	normalized, err := json.Marshal(payload)
	if err != nil {
		return Decision{}, err
	}
	sum := sha256.Sum256(append([]byte("v1:"+kind+":"), normalized...))
	digest := hex.EncodeToString(sum[:])
	receipt, err := q.GetReadingReceipt(ctx, database.GetReadingReceiptParams{UserID: user, EventID: event})
	if err == nil {
		if receipt.Digest != digest {
			return Decision{}, fail(409, "idempotency_conflict")
		}
		return Decision{
			EventID: event, Kind: kind, Status: int(receipt.Status), Revision: receipt.Revision,
			Code: receipt.Code, CurrentRevision: receipt.CurrentRevision,
		}, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return Decision{}, err
	}
	if err = live(ctx, q, document); err != nil {
		return Decision{}, err
	}
	if err = owned(ctx, q, user, device); err != nil {
		return Decision{}, err
	}
	out, err := effect(q)
	if err != nil {
		return Decision{}, err
	}
	out.EventID = event
	out.Kind = kind
	err = q.InsertReadingReceipt(ctx, database.InsertReadingReceiptParams{
		UserID: user, EventID: event, DocumentID: document, Kind: kind,
		Payload: string(normalized), Digest: digest, ObservedAt: observed, Status: int64(out.Status),
		Revision: out.Revision, Code: out.Code, CurrentRevision: out.CurrentRevision,
	})
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

func advance(ctx context.Context, q *database.Queries, user, document, device, position string, f float64, base *string, snapshot *deviceSnapshot) (Decision, error) {
	head, err := state(ctx, q, user, document)
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
		name, err := q.GetReadingDeviceName(ctx, device)
		if err != nil {
			return Decision{}, err
		}
		snapshot = &deviceSnapshot{ExternalID: &device, Name: name}
	} else if snapshot.ExternalID == nil {
		// Optional Field - Upstream HSET leaves an already stored device_id intact when the next write omits it.
		snapshot.ExternalID = head.ExternalDeviceID
	}
	next := strconv.FormatInt(n+1, 10)
	// Accepted State - Server arrival advances the shared revision; observation time and fraction never select a winner.
	updated := time.Now().UTC().Format(time.RFC3339)
	if err = q.UpsertReadingHead(ctx, database.UpsertReadingHeadParams{
		UserID: user, DocumentID: document, Revision: n + 1,
		Position: &position, Fraction: &f, DeviceID: &device, UpdatedAt: &updated,
	}); err != nil {
		return Decision{}, err
	}
	if err = q.UpsertReadingHeadDevice(ctx, database.UpsertReadingHeadDeviceParams{
		UserID: user, DocumentID: document, ExternalID: snapshot.ExternalID, DeviceName: snapshot.Name,
	}); err != nil {
		return Decision{}, err
	}
	_, err = q.UpdateProgress(ctx, database.UpdateProgressParams{UserID: user, DocumentID: document, DeviceID: device, Percentage: f, Progress: position})
	return Decision{Status: 200, Revision: &next}, err
}
func (s *Store) Progress(ctx context.Context, user string, e Progress) (Decision, error) {
	if !validID(e.DocumentID) || !validID(e.DeviceID) || !validID(e.EventID) || !revisionPattern.MatchString(e.BaseRevision) || !fraction(e.Fraction) || !utf8.ValidString(e.Position) || utf8.RuneCountInString(e.Position) < 1 || utf8.RuneCountInString(e.Position) > 4096 || e.ObservedAt.IsZero() {
		return Decision{}, fail(400, "invalid_request")
	}
	e.ObservedAt = e.ObservedAt.UTC()
	e.Fraction = zero(e.Fraction)
	return s.apply(ctx, user, e.EventID, e.DocumentID, e.DeviceID, "progress", e.ObservedAt.Format(time.RFC3339Nano), e, func(q *database.Queries) (Decision, error) {
		return advance(ctx, q, user, e.DocumentID, e.DeviceID, e.Position, e.Fraction, &e.BaseRevision, nil)
	})
}
func credit(ctx context.Context, q *database.Queries, user string, e Activity) error {
	if !validID(e.DocumentID) || !validID(e.DeviceID) || !fraction(e.StartFraction) || !fraction(e.EndFraction) || e.StartFraction > e.EndFraction || e.Duration < 0 || e.Duration > 86400 || e.StartTime.IsZero() {
		return fail(400, "invalid_request")
	}
	return q.InsertReadingActivity(ctx, database.InsertReadingActivityParams{
		UserID: user, DocumentID: e.DocumentID, DeviceID: e.DeviceID,
		StartTime: e.StartTime.UTC().Format(time.RFC3339Nano), Duration: int64(e.Duration),
		StartPercentage: e.StartFraction, EndPercentage: e.EndFraction,
	})
}
func (s *Store) Activity(ctx context.Context, user string, e Activity) (Decision, error) {
	e.StartTime = e.StartTime.UTC()
	e.StartFraction = zero(e.StartFraction)
	e.EndFraction = zero(e.EndFraction)
	if !validID(e.EventID) {
		return Decision{}, fail(400, "invalid_request")
	}
	return s.apply(ctx, user, e.EventID, e.DocumentID, e.DeviceID, "activity", e.StartTime.Format(time.RFC3339Nano), e, func(q *database.Queries) (Decision, error) {
		return Decision{Status: 200}, credit(ctx, q, user, e)
	})
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
	q := database.New(tx)
	if err = account(ctx, q, user); err != nil {
		return "", err
	}
	device, err := koDevice(ctx, q, user, externalID, name)
	if err != nil {
		return "", err
	}
	if err = q.EnsureReadingDocument(ctx, document); err != nil {
		return "", err
	}
	if err = live(ctx, q, document); err != nil {
		return "", err
	}
	out, err := advance(ctx, q, user, document, device, position, f, nil, &deviceSnapshot{ExternalID: externalID, Name: name})
	if err != nil {
		return "", err
	}
	if out.Status != 200 {
		return "", fail(out.Status, out.Code)
	}
	timestamp, err := q.GetReadingHeadUpdatedAt(ctx, database.GetReadingHeadUpdatedAtParams{UserID: user, DocumentID: document})
	if err != nil {
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
	q := database.New(tx)
	if err = account(ctx, q, user); err == nil {
		err = register(ctx, q, user, device, name)
	}
	if err != nil {
		return err
	}
	for _, e := range events {
		e.DeviceID = device
		if err = q.EnsureReadingDocument(ctx, e.DocumentID); err != nil {
			return err
		}
		// SyncNinja Cursor - Historical activity advances the device cursor even when the book is no longer in the catalog.
		if err = credit(ctx, q, user, e); err != nil {
			return err
		}
	}
	return tx.Commit()
}
