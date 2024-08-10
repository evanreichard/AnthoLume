package database

import (
	"fmt"
	"testing"
	"time"

	"github.com/stretchr/testify/suite"

	"reichard.io/antholume/config"
	"reichard.io/antholume/utils"
)

var (
	userID           string = "testUser"
	userPass         string = "testPass"
	deviceID         string = "testDevice"
	deviceName       string = "testDeviceName"
	documentID       string = "testDocument"
	documentTitle    string = "testTitle"
	documentAuthor   string = "testAuthor"
	documentFilepath string = "./testPath.epub"
	documentWords    int64  = 5000
)

type DatabaseTestSuite struct {
	suite.Suite
	dbm *DBManager
}

func TestDatabase(t *testing.T) {
	suite.Run(t, new(DatabaseTestSuite))
}

// PROGRESS - TODO:
// 	- 󰊕  (q *Queries) GetProgress
// 	- 󰊕  (q *Queries) UpdateProgress

func (suite *DatabaseTestSuite) SetupTest() {
	cfg := config.Config{
		DBType: "memory",
	}

	suite.dbm = NewMgr(&cfg)

	// Create User
	rawAuthHash, _ := utils.GenerateToken(64)
	authHash := fmt.Sprintf("%x", rawAuthHash)
	_, err := suite.dbm.Queries.CreateUser(suite.dbm.Ctx, CreateUserParams{
		ID:       userID,
		Pass:     &userPass,
		AuthHash: &authHash,
	})
	suite.NoError(err)

	// Create Document
	_, err = suite.dbm.Queries.UpsertDocument(suite.dbm.Ctx, UpsertDocumentParams{
		ID:       documentID,
		Title:    &documentTitle,
		Author:   &documentAuthor,
		Filepath: &documentFilepath,
		Words:    &documentWords,
	})
	suite.NoError(err)

	// Create Device
	_, err = suite.dbm.Queries.UpsertDevice(suite.dbm.Ctx, UpsertDeviceParams{
		ID:         deviceID,
		UserID:     userID,
		DeviceName: deviceName,
	})
	suite.NoError(err)

	// Create Activity
	end := time.Now()
	start := end.AddDate(0, 0, -9)
	var counter int64 = 0

	for d := start; d.After(end) == false; d = d.AddDate(0, 0, 1) {
		counter += 1

		// Add Item
		activity, err := suite.dbm.Queries.AddActivity(suite.dbm.Ctx, AddActivityParams{
			DocumentID:      documentID,
			DeviceID:        deviceID,
			UserID:          userID,
			StartTime:       d.UTC().Format(time.RFC3339),
			Duration:        60,
			StartPercentage: float64(counter) / 100.0,
			EndPercentage:   float64(counter+1) / 100.0,
		})

		suite.Nil(err, fmt.Sprintf("[%d] should have nil err for add activity", counter))
		suite.Equal(counter, activity.ID, fmt.Sprintf("[%d] should have correct id for add activity", counter))
	}

	// Initiate Cache
	err = suite.dbm.CacheTempTables()
	suite.NoError(err)
}

// DEVICES - TODO:
//   - 󰊕  (q *Queries) GetDevice
//   - 󰊕  (q *Queries) GetDevices
//   - 󰊕  (q *Queries) UpsertDevice
func (suite *DatabaseTestSuite) TestDevice() {
	testDevice := "dev123"
	device, err := suite.dbm.Queries.UpsertDevice(suite.dbm.Ctx, UpsertDeviceParams{
		ID:         testDevice,
		UserID:     userID,
		DeviceName: deviceName,
	})

	suite.Nil(err, "should have nil err")
	suite.Equal(testDevice, device.ID, "should have device id")
	suite.Equal(userID, device.UserID, "should have user id")
	suite.Equal(deviceName, device.DeviceName, "should have device name")
}

// ACTIVITY - TODO:
//   - 󰊕  (q *Queries) AddActivity
//   - 󰊕  (q *Queries) GetActivity
//   - 󰊕  (q *Queries) GetLastActivity
func (suite *DatabaseTestSuite) TestActivity() {
	// Validate Exists
	existsRows, err := suite.dbm.Queries.GetActivity(suite.dbm.Ctx, GetActivityParams{
		UserID: userID,
		Offset: 0,
		Limit:  50,
	})

	suite.Nil(err, "should have nil err for get activity")
	suite.Len(existsRows, 10, "should have correct number of rows get activity")

	// Validate Doesn't Exist
	doesntExistsRows, err := suite.dbm.Queries.GetActivity(suite.dbm.Ctx, GetActivityParams{
		UserID:     userID,
		DocumentID: "unknownDoc",
		DocFilter:  true,
		Offset:     0,
		Limit:      50,
	})

	suite.Nil(err, "should have nil err for get activity")
	suite.Len(doesntExistsRows, 0, "should have no rows")
}

// MISC - TODO:
//   - 󰊕  (q *Queries) AddMetadata
//   - 󰊕  (q *Queries) GetDailyReadStats
//   - 󰊕  (q *Queries) GetDatabaseInfo
//   - 󰊕  (q *Queries) UpdateSettings
func (suite *DatabaseTestSuite) TestGetDailyReadStats() {
	readStats, err := suite.dbm.Queries.GetDailyReadStats(suite.dbm.Ctx, userID)

	suite.Nil(err, "should have nil err")
	suite.Len(readStats, 30, "should have length of 30")

	// Validate 1 Minute / Day - Last 10 Days
	for i := 0; i < 10; i++ {
		stat := readStats[i]
		suite.Equal(int64(1), stat.MinutesRead, "should have one minute read")
	}

	// Validate 0 Minute / Day - Remaining 20 Days
	for i := 10; i < 30; i++ {
		stat := readStats[i]
		suite.Equal(int64(0), stat.MinutesRead, "should have zero minutes read")
	}
}
