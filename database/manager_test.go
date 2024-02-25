package database

import (
	"fmt"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"reichard.io/antholume/config"
	"reichard.io/antholume/utils"
)

type databaseTest struct {
	*testing.T
	dbm *DBManager
}

var userID string = "testUser"
var userPass string = "testPass"
var deviceID string = "testDevice"
var deviceName string = "testDeviceName"
var documentID string = "testDocument"
var documentTitle string = "testTitle"
var documentAuthor string = "testAuthor"

func TestNewMgr(t *testing.T) {
	cfg := config.Config{
		DBType: "memory",
	}

	dbm := NewMgr(&cfg)
	assert.NotNil(t, dbm, "should not be nil dbm")

	t.Run("Database", func(t *testing.T) {
		dt := databaseTest{t, dbm}
		dt.TestUser()
		dt.TestDocument()
		dt.TestDevice()
		dt.TestActivity()
		dt.TestDailyReadStats()
	})
}

func (dt *databaseTest) TestUser() {
	dt.Run("User", func(t *testing.T) {
		// Generate Auth Hash
		rawAuthHash, err := utils.GenerateToken(64)
		assert.Nil(t, err, "should be nil err")

		authHash := fmt.Sprintf("%x", rawAuthHash)
		changed, err := dt.dbm.Queries.CreateUser(dt.dbm.Ctx, CreateUserParams{
			ID:       userID,
			Pass:     &userPass,
			AuthHash: &authHash,
		})

		assert.Nil(t, err, "should be nil err")
		assert.Equal(t, int64(1), changed)

		user, err := dt.dbm.Queries.GetUser(dt.dbm.Ctx, userID)

		assert.Nil(t, err, "should be nil err")
		assert.Equal(t, userPass, *user.Pass)
	})
}

func (dt *databaseTest) TestDocument() {
	dt.Run("Document", func(t *testing.T) {
		doc, err := dt.dbm.Queries.UpsertDocument(dt.dbm.Ctx, UpsertDocumentParams{
			ID:     documentID,
			Title:  &documentTitle,
			Author: &documentAuthor,
		})

		if err != nil {
			t.Fatalf(`Expected: Document, Got: %v, Error: %v`, doc, err)
		}

		if doc.ID != documentID {
			t.Fatalf(`Expected: %v, Got: %v`, documentID, doc.ID)
		}

		if *doc.Title != documentTitle {
			t.Fatalf(`Expected: %v, Got: %v`, documentTitle, *doc.Title)
		}

		if *doc.Author != documentAuthor {
			t.Fatalf(`Expected: %v, Got: %v`, documentAuthor, *doc.Author)
		}
	})
}

func (dt *databaseTest) TestDevice() {
	dt.Run("Device", func(t *testing.T) {
		device, err := dt.dbm.Queries.UpsertDevice(dt.dbm.Ctx, UpsertDeviceParams{
			ID:         deviceID,
			UserID:     userID,
			DeviceName: deviceName,
		})

		if err != nil {
			t.Fatalf(`Expected: Device, Got: %v, Error: %v`, device, err)
		}

		if device.ID != deviceID {
			t.Fatalf(`Expected: %v, Got: %v`, deviceID, device.ID)
		}

		if device.UserID != userID {
			t.Fatalf(`Expected: %v, Got: %v`, userID, device.UserID)
		}

		if device.DeviceName != deviceName {
			t.Fatalf(`Expected: %v, Got: %v`, deviceName, device.DeviceName)
		}
	})
}

func (dt *databaseTest) TestActivity() {
	dt.Run("Progress", func(t *testing.T) {
		// 10 Activities, 10 Days
		end := time.Now()
		start := end.AddDate(0, 0, -9)
		var counter int64 = 0

		for d := start; d.After(end) == false; d = d.AddDate(0, 0, 1) {
			counter += 1

			// Add Item
			activity, err := dt.dbm.Queries.AddActivity(dt.dbm.Ctx, AddActivityParams{
				DocumentID:      documentID,
				DeviceID:        deviceID,
				UserID:          userID,
				StartTime:       d.UTC().Format(time.RFC3339),
				Duration:        60,
				StartPercentage: float64(counter) / 100.0,
				EndPercentage:   float64(counter+1) / 100.0,
			})

			// Validate No Error
			if err != nil {
				t.Fatalf(`expected: rawactivity, got: %v, error: %v`, activity, err)
			}

			// Validate Auto Increment Working
			if activity.ID != counter {
				t.Fatalf(`Expected: %v, Got: %v`, counter, activity.ID)
			}
		}

		// Initiate Cache
		dt.dbm.CacheTempTables()

		// Validate Exists
		existsRows, err := dt.dbm.Queries.GetActivity(dt.dbm.Ctx, GetActivityParams{
			UserID: userID,
			Offset: 0,
			Limit:  50,
		})

		if err != nil {
			t.Fatalf(`Expected: []GetActivityRow, Got: %v, Error: %v`, existsRows, err)
		}

		if len(existsRows) != 10 {
			t.Fatalf(`Expected: %v, Got: %v`, 10, len(existsRows))
		}

		// Validate Doesn't Exist
		doesntExistsRows, err := dt.dbm.Queries.GetActivity(dt.dbm.Ctx, GetActivityParams{
			UserID:     userID,
			DocumentID: "unknownDoc",
			DocFilter:  true,
			Offset:     0,
			Limit:      50,
		})

		if err != nil {
			t.Fatalf(`Expected: []GetActivityRow, Got: %v, Error: %v`, doesntExistsRows, err)
		}

		if len(doesntExistsRows) != 0 {
			t.Fatalf(`Expected: %v, Got: %v`, 0, len(doesntExistsRows))
		}
	})
}

func (dt *databaseTest) TestDailyReadStats() {
	dt.Run("DailyReadStats", func(t *testing.T) {
		readStats, err := dt.dbm.Queries.GetDailyReadStats(dt.dbm.Ctx, userID)

		if err != nil {
			t.Fatalf(`Expected: []GetDailyReadStatsRow, Got: %v, Error: %v`, readStats, err)
		}

		// Validate 30 Days Stats
		if len(readStats) != 30 {
			t.Fatalf(`Expected: %v, Got: %v`, 30, len(readStats))
		}

		// Validate 1 Minute / Day - Last 10 Days
		for i := 0; i < 10; i++ {
			stat := readStats[i]
			if stat.MinutesRead != 1 {
				t.Fatalf(`Day: %v, Expected: %v, Got: %v`, stat.Date, 1, stat.MinutesRead)
			}
		}

		// Validate 0 Minute / Day - Remaining 20 Days
		for i := 10; i < 30; i++ {
			stat := readStats[i]
			if stat.MinutesRead != 0 {
				t.Fatalf(`Day: %v, Expected: %v, Got: %v`, stat.Date, 0, stat.MinutesRead)
			}
		}
	})
}
