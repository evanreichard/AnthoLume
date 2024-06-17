package database

import (
	"database/sql"
	"fmt"
	"testing"
	"time"

	"github.com/stretchr/testify/suite"

	"reichard.io/antholume/config"
	"reichard.io/antholume/utils"
)

var (
	testUserID   string = "testUser"
	testUserPass string = "testPass"
)

type UsersTestSuite struct {
	suite.Suite
	dbm *DBManager
}

func TestUsers(t *testing.T) {
	suite.Run(t, new(UsersTestSuite))
}

func (suite *UsersTestSuite) SetupTest() {
	cfg := config.Config{
		DBType: "memory",
	}

	suite.dbm = NewMgr(&cfg)

	// Create User
	rawAuthHash, _ := utils.GenerateToken(64)
	authHash := fmt.Sprintf("%x", rawAuthHash)
	_, err := suite.dbm.Queries.CreateUser(suite.dbm.Ctx, CreateUserParams{
		ID:       testUserID,
		Pass:     &testUserPass,
		AuthHash: &authHash,
	})
	suite.NoError(err)

	// Create Document
	_, err = suite.dbm.Queries.UpsertDocument(suite.dbm.Ctx, UpsertDocumentParams{
		ID:     documentID,
		Title:  &documentTitle,
		Author: &documentAuthor,
		Words:  &documentWords,
	})
	suite.NoError(err)

	// Create Device
	_, err = suite.dbm.Queries.UpsertDevice(suite.dbm.Ctx, UpsertDeviceParams{
		ID:         deviceID,
		UserID:     testUserID,
		DeviceName: deviceName,
	})
	suite.NoError(err)
}

func (suite *UsersTestSuite) TestGetUser() {
	user, err := suite.dbm.Queries.GetUser(suite.dbm.Ctx, testUserID)
	suite.Nil(err, "should have nil err")
	suite.Equal(testUserPass, *user.Pass)
}

func (suite *UsersTestSuite) TestCreateUser() {
	testUser := "user1"
	testPass := "pass1"

	// Generate Auth Hash
	rawAuthHash, err := utils.GenerateToken(64)
	suite.Nil(err, "should have nil err")

	authHash := fmt.Sprintf("%x", rawAuthHash)
	changed, err := suite.dbm.Queries.CreateUser(suite.dbm.Ctx, CreateUserParams{
		ID:       testUser,
		Pass:     &testPass,
		AuthHash: &authHash,
	})

	suite.Nil(err, "should have nil err")
	suite.Equal(int64(1), changed)

	user, err := suite.dbm.Queries.GetUser(suite.dbm.Ctx, testUser)
	suite.Nil(err, "should have nil err")
	suite.Equal(testPass, *user.Pass)
}

func (suite *UsersTestSuite) TestDeleteUser() {
	changed, err := suite.dbm.Queries.DeleteUser(suite.dbm.Ctx, testUserID)
	suite.Nil(err, "should have nil err")
	suite.Equal(int64(1), changed, "should have one changed row")

	_, err = suite.dbm.Queries.GetUser(suite.dbm.Ctx, testUserID)
	suite.ErrorIs(err, sql.ErrNoRows, "should have no rows error")
}

func (suite *UsersTestSuite) TestGetUsers() {
	users, err := suite.dbm.Queries.GetUsers(suite.dbm.Ctx)
	suite.Nil(err, "should have nil err")
	suite.Len(users, 1, "should have single user")
}

func (suite *UsersTestSuite) TestUpdateUser() {
	newPassword := "newPass123"
	user, err := suite.dbm.Queries.UpdateUser(suite.dbm.Ctx, UpdateUserParams{
		UserID:   testUserID,
		Password: &newPassword,
	})
	suite.Nil(err, "should have nil err")
	suite.Equal(newPassword, *user.Pass, "should have new password")
}

func (suite *UsersTestSuite) TestGetUserStatistics() {
	err := suite.dbm.CacheTempTables()
	suite.NoError(err)

	// Ensure Zero Items
	userStats, err := suite.dbm.Queries.GetUserStatistics(suite.dbm.Ctx)
	suite.Nil(err, "should have nil err")
	suite.Empty(userStats, "should be empty")

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
			UserID:          testUserID,
			StartTime:       d.UTC().Format(time.RFC3339),
			Duration:        60,
			StartPercentage: float64(counter) / 100.0,
			EndPercentage:   float64(counter+1) / 100.0,
		})

		suite.Nil(err, fmt.Sprintf("[%d] should have nil err for add activity", counter))
		suite.Equal(counter, activity.ID, fmt.Sprintf("[%d] should have correct id for add activity", counter))
	}

	err = suite.dbm.CacheTempTables()
	suite.NoError(err)

	// Ensure One Item
	userStats, err = suite.dbm.Queries.GetUserStatistics(suite.dbm.Ctx)
	suite.Nil(err, "should have nil err")
	suite.Len(userStats, 1, "should have length of one")
}

func (suite *UsersTestSuite) TestGetUsersStreaks() {
	err := suite.dbm.CacheTempTables()
	suite.NoError(err)

	// Ensure Zero Items
	userStats, err := suite.dbm.Queries.GetUserStreaks(suite.dbm.Ctx, testUserID)
	suite.Nil(err, "should have nil err")
	suite.Empty(userStats, "should be empty")

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
			UserID:          testUserID,
			StartTime:       d.UTC().Format(time.RFC3339),
			Duration:        60,
			StartPercentage: float64(counter) / 100.0,
			EndPercentage:   float64(counter+1) / 100.0,
		})

		suite.Nil(err, fmt.Sprintf("[%d] should have nil err for add activity", counter))
		suite.Equal(counter, activity.ID, fmt.Sprintf("[%d] should have correct id for add activity", counter))
	}

	err = suite.dbm.CacheTempTables()
	suite.NoError(err)

	// Ensure Two Item
	userStats, err = suite.dbm.Queries.GetUserStreaks(suite.dbm.Ctx, testUserID)
	suite.Nil(err, "should have nil err")
	suite.Len(userStats, 2, "should have length of two")

	// Ensure Streak Stats
	dayStats := userStats[0]
	weekStats := userStats[1]
	suite.Equal(int64(10), dayStats.CurrentStreak, "should be 10 days")
	suite.Greater(weekStats.CurrentStreak, int64(1), "should be 2 or 3")
}
