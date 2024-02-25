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
	assert.NotNil(t, dbm, "should not have nil dbm")

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
		assert.Nil(t, err, "should have nil err")

		authHash := fmt.Sprintf("%x", rawAuthHash)
		changed, err := dt.dbm.Queries.CreateUser(dt.dbm.Ctx, CreateUserParams{
			ID:       userID,
			Pass:     &userPass,
			AuthHash: &authHash,
		})

		assert.Nil(t, err, "should have nil err")
		assert.Equal(t, int64(1), changed)

		user, err := dt.dbm.Queries.GetUser(dt.dbm.Ctx, userID)

		assert.Nil(t, err, "should have nil err")
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

		assert.Nil(t, err, "should have nil err")
		assert.Equal(t, documentID, doc.ID, "should have document id")
		assert.Equal(t, documentTitle, *doc.Title, "should have document title")
		assert.Equal(t, documentAuthor, *doc.Author, "should have document author")
	})
}

func (dt *databaseTest) TestDevice() {
	dt.Run("Device", func(t *testing.T) {
		device, err := dt.dbm.Queries.UpsertDevice(dt.dbm.Ctx, UpsertDeviceParams{
			ID:         deviceID,
			UserID:     userID,
			DeviceName: deviceName,
		})

		assert.Nil(t, err, "should have nil err")
		assert.Equal(t, deviceID, device.ID, "should have device id")
		assert.Equal(t, userID, device.UserID, "should have user id")
		assert.Equal(t, deviceName, device.DeviceName, "should have device name")
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

			assert.Nil(t, err, fmt.Sprintf("[%d] should have nil err for add activity", counter))
			assert.Equal(t, counter, activity.ID, fmt.Sprintf("[%d] should have correct id for add activity", counter))
		}

		// Initiate Cache
		dt.dbm.CacheTempTables()

		// Validate Exists
		existsRows, err := dt.dbm.Queries.GetActivity(dt.dbm.Ctx, GetActivityParams{
			UserID: userID,
			Offset: 0,
			Limit:  50,
		})

		assert.Nil(t, err, "should have nil err for get activity")
		assert.Len(t, existsRows, 10, "should have correct number of rows get activity")

		// Validate Doesn't Exist
		doesntExistsRows, err := dt.dbm.Queries.GetActivity(dt.dbm.Ctx, GetActivityParams{
			UserID:     userID,
			DocumentID: "unknownDoc",
			DocFilter:  true,
			Offset:     0,
			Limit:      50,
		})

		assert.Nil(t, err, "should have nil err for get activity")
		assert.Len(t, doesntExistsRows, 0, "should have no rows")
	})
}

func (dt *databaseTest) TestDailyReadStats() {
	dt.Run("DailyReadStats", func(t *testing.T) {
		readStats, err := dt.dbm.Queries.GetDailyReadStats(dt.dbm.Ctx, userID)

		assert.Nil(t, err, "should have nil err")
		assert.Len(t, readStats, 30, "should have length of 30")

		// Validate 1 Minute / Day - Last 10 Days
		for i := 0; i < 10; i++ {
			stat := readStats[i]
			assert.Equal(t, int64(1), stat.MinutesRead, "should have one minute read")
		}

		// Validate 0 Minute / Day - Remaining 20 Days
		for i := 10; i < 30; i++ {
			stat := readStats[i]
			assert.Equal(t, int64(0), stat.MinutesRead, "should have zero minutes read")
		}
	})
}
