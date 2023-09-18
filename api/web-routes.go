package api

import (
	"net/http"

	argon2 "github.com/alexedwards/argon2id"
	"github.com/gin-gonic/gin"
	"reichard.io/bbank/database"
)

type infoResponse struct {
	Authorized bool   `json:"authorized"`
	Version    string `json:"version"`
}

type queryParams struct {
	Page     *int64  `form:"page"`
	Limit    *int64  `form:"limit"`
	Document *string `form:"document"`
}

func bindQueryParams(c *gin.Context) queryParams {
	var qParams queryParams
	c.BindQuery(&qParams)

	if qParams.Limit == nil {
		var defaultValue int64 = 50
		qParams.Limit = &defaultValue
	} else if *qParams.Limit < 0 {
		var zeroValue int64 = 0
		qParams.Limit = &zeroValue
	}

	if qParams.Page == nil || *qParams.Page < 1 {
		var oneValue int64 = 0
		qParams.Page = &oneValue
	}

	return qParams
}

func (api *API) serverInfo(c *gin.Context) {
	respData := infoResponse{
		Authorized: false,
		Version:    api.Config.Version,
	}

	var rHeader authHeader
	if err := c.ShouldBindHeader(&rHeader); err != nil {
		c.JSON(200, respData)
		return
	}
	if rHeader.AuthUser == "" || rHeader.AuthKey == "" {
		c.JSON(200, respData)
		return
	}

	user, err := api.DB.Queries.GetUser(api.DB.Ctx, rHeader.AuthUser)
	if err != nil {
		c.JSON(200, respData)
		return
	}

	match, err := argon2.ComparePasswordAndHash(rHeader.AuthKey, user.Pass)
	if err != nil || match != true {
		c.JSON(200, respData)
		return
	}

	respData.Authorized = true
	c.JSON(200, respData)
}

func (api *API) getDocuments(c *gin.Context) {
	qParams := bindQueryParams(c)

	documents, err := api.DB.Queries.GetDocuments(api.DB.Ctx, database.GetDocumentsParams{
		Offset: (*qParams.Page - 1) * *qParams.Limit,
		Limit:  *qParams.Limit,
	})
	if err != nil {
		c.AbortWithStatusJSON(http.StatusBadRequest, gin.H{"error": "Invalid Request"})
		return
	}

	if documents == nil {
		documents = []database.Document{}
	}

	c.JSON(http.StatusOK, documents)
}

func (api *API) getUsers(c *gin.Context) {
	rUser, _ := c.Get("AuthorizedUser")
	qParams := bindQueryParams(c)

	users, err := api.DB.Queries.GetUsers(api.DB.Ctx, database.GetUsersParams{
		User:   rUser.(string),
		Offset: (*qParams.Page - 1) * *qParams.Limit,
		Limit:  *qParams.Limit,
	})
	if err != nil {
		c.AbortWithStatusJSON(http.StatusBadRequest, gin.H{"error": "Invalid Request"})
		return
	}

	if users == nil {
		users = []database.User{}
	}

	c.JSON(http.StatusOK, users)
}

func (api *API) getActivity(c *gin.Context) {
	rUser, _ := c.Get("AuthorizedUser")
	qParams := bindQueryParams(c)

	dbActivityParams := database.GetActivityParams{
		UserID:     rUser.(string),
		DocFilter:  false,
		DocumentID: "",
		Offset:     (*qParams.Page - 1) * *qParams.Limit,
		Limit:      *qParams.Limit,
	}

	if qParams.Document != nil {
		dbActivityParams.DocFilter = true
		dbActivityParams.DocumentID = *qParams.Document
	}

	activity, err := api.DB.Queries.GetActivity(api.DB.Ctx, dbActivityParams)
	if err != nil {
		c.AbortWithStatusJSON(http.StatusBadRequest, gin.H{"error": "Invalid Request"})
		return
	}

	if activity == nil {
		activity = []database.Activity{}
	}

	c.JSON(http.StatusOK, activity)
}

func (api *API) getDevices(c *gin.Context) {
	rUser, _ := c.Get("AuthorizedUser")
	qParams := bindQueryParams(c)

	devices, err := api.DB.Queries.GetDevices(api.DB.Ctx, database.GetDevicesParams{
		UserID: rUser.(string),
		Offset: (*qParams.Page - 1) * *qParams.Limit,
		Limit:  *qParams.Limit,
	})
	if err != nil {
		c.AbortWithStatusJSON(http.StatusBadRequest, gin.H{"error": "Invalid Request"})
		return
	}

	if devices == nil {
		devices = []database.Device{}
	}

	c.JSON(http.StatusOK, devices)
}
