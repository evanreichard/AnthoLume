package contract

import (
	"context"
	"crypto/sha256"
	"database/sql"
	_ "embed"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"

	_ "modernc.org/sqlite"
	"reichard.io/antholume/database"
)

//go:embed fixture.sql
var fixture string

type Store struct{ DB *sql.DB }

func OpenStore(path string, initialize bool) (*Store, error) {
	db, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	if _, err = db.Exec("PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;"); err == nil && initialize {
		_, err = db.Exec(fixture)
	}
	if err != nil {
		db.Close()
		return nil, err
	}
	return &Store{DB: db}, nil
}

type outcome struct {
	status int
	body   []byte
}

func problem(status int, code string) Problem {
	return Problem{Type: "urn:antholume:problem:" + code, Title: "Request failed", Status: status, Code: code, Detail: "The request could not be completed."}
}
func failed(status int, code string) outcome {
	b, _ := json.Marshal(problem(status, code))
	return outcome{status, b}
}

// Receipt Identity - Callers normalize timestamps and signed zero before typed JSON hashing; kind separates operations.
func identity(kind string, event any) string {
	b, _ := json.Marshal(event)
	h := sha256.Sum256(append([]byte(kind+":"), b...))
	return hex.EncodeToString(h[:])
}

func (s *Store) apply(ctx context.Context, user, eventID, document, device, digest string, effect func(*sql.Tx) (outcome, error)) (outcome, error) {
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return outcome{}, err
	}
	defer tx.Rollback()
	var oldDigest string
	var result outcome
	err = tx.QueryRowContext(ctx, "SELECT digest,status,body FROM proof_receipts WHERE user_id=? AND event_id=?", user, eventID).Scan(&oldDigest, &result.status, &result.body)
	if err == nil {
		if oldDigest != digest {
			return failed(409, "idempotency_conflict"), nil
		}
		return result, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return outcome{}, err
	}
	var allowed int
	err = tx.QueryRowContext(ctx, `SELECT count(*) FROM devices,documents WHERE devices.id=? AND devices.user_id=? AND documents.id=? AND documents.deleted=0`, device, user, document).Scan(&allowed)
	if err != nil {
		return outcome{}, err
	}
	if allowed != 1 {
		return failed(403, "resource_forbidden"), nil
	}
	result, err = effect(tx)
	if err != nil {
		return outcome{}, err
	}
	_, err = tx.ExecContext(ctx, "INSERT INTO proof_receipts(user_id,event_id,digest,status,body) VALUES(?,?,?,?,?)", user, eventID, digest, result.status, result.body)
	if err != nil {
		return outcome{}, err
	}
	if err = tx.Commit(); err != nil {
		return outcome{}, err
	}
	return result, nil
}

func canonicalFraction(value float64) float64 {
	if value == 0 {
		return 0
	}
	return value
}

func (s *Store) Progress(ctx context.Context, user string, e ProgressEvent) (outcome, error) {
	e.ObservedAt = e.ObservedAt.UTC()
	e.Fraction = canonicalFraction(e.Fraction)
	return s.apply(ctx, user, e.EventId, e.DocumentId, e.DeviceId, identity("progress", e), func(tx *sql.Tx) (outcome, error) {
		revision, err := advance(ctx, tx, user, e.DocumentId, &e.BaseRevision)
		if err != nil {
			return outcome{}, err
		}
		if revision == "" {
			var current string
			if err = tx.QueryRowContext(ctx, "SELECT CAST(revision AS TEXT) FROM proof_heads WHERE user_id=? AND document_id=?", user, e.DocumentId).Scan(&current); err != nil {
				return outcome{}, err
			}
			p := problem(409, "progress_conflict")
			p.CurrentRevision = &current
			b, _ := json.Marshal(p)
			return outcome{409, b}, nil
		}
		_, err = database.New(tx).UpdateProgress(ctx, database.UpdateProgressParams{UserID: user, DocumentID: e.DocumentId, DeviceID: e.DeviceId, Percentage: e.Fraction, Progress: e.Position})
		if err != nil {
			return outcome{}, err
		}
		b, _ := json.Marshal(Receipt{EventId: e.EventId, Kind: Progress, Revision: &revision})
		return outcome{200, b}, nil
	})
}

func advance(ctx context.Context, tx *sql.Tx, user, document string, base *string) (string, error) {
	if _, err := tx.ExecContext(ctx, "INSERT OR IGNORE INTO proof_heads(user_id,document_id,revision) VALUES(?,?,0)", user, document); err != nil {
		return "", err
	}
	query := "UPDATE proof_heads SET revision=revision+1 WHERE user_id=? AND document_id=? AND revision<999999999999999999"
	args := []any{user, document}
	if base != nil {
		query += " AND revision=CAST(? AS INTEGER)"
		args = append(args, *base)
	}
	r, err := tx.ExecContext(ctx, query, args...)
	if err != nil {
		return "", err
	}
	n, err := r.RowsAffected()
	if err != nil {
		return "", err
	}
	if n != 1 {
		return "", nil
	}
	var revision int64
	err = tx.QueryRowContext(ctx, "SELECT revision FROM proof_heads WHERE user_id=? AND document_id=?", user, document).Scan(&revision)
	return strconv.FormatInt(revision, 10), err
}

func (s *Store) Activity(ctx context.Context, user string, e ActivityEvent) (outcome, error) {
	e.StartTime = e.StartTime.UTC()
	e.StartFraction = canonicalFraction(e.StartFraction)
	e.EndFraction = canonicalFraction(e.EndFraction)
	if e.EndFraction < e.StartFraction {
		return failed(400, "validation"), nil
	}
	return s.apply(ctx, user, e.EventId, e.DocumentId, e.DeviceId, identity("activity", e), func(tx *sql.Tx) (outcome, error) {
		_, err := tx.ExecContext(ctx, `INSERT INTO activity(user_id,document_id,device_id,start_time,start_percentage,end_percentage,duration) VALUES(?,?,?,?,?,?,?)`, user, e.DocumentId, e.DeviceId, e.StartTime.UTC().Format("2006-01-02T15:04:05.999999999Z"), e.StartFraction, e.EndFraction, e.Duration)
		if err != nil {
			return outcome{}, err
		}
		b, _ := json.Marshal(Receipt{EventId: e.EventId, Kind: Activity})
		return outcome{200, b}, nil
	})
}

// KO Coexistence - This operation models an accepted legacy write, not the KO wire/auth adapter. No web receipt is invented.
func (s *Store) KOWrite(ctx context.Context, user, document, device, position string, fraction float64) error {
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	var owner string
	if err = tx.QueryRowContext(ctx, "SELECT user_id FROM devices WHERE id=?", device).Scan(&owner); err != nil {
		return err
	}
	if owner != user {
		return fmt.Errorf("device owner mismatch")
	}
	revision, err := advance(ctx, tx, user, document, nil)
	if err != nil {
		return err
	}
	if revision == "" {
		return fmt.Errorf("revision exhausted")
	}
	_, err = database.New(tx).UpdateProgress(ctx, database.UpdateProgressParams{UserID: user, DocumentID: document, DeviceID: device, Percentage: fraction, Progress: position})
	if err != nil {
		return err
	}
	return tx.Commit()
}
