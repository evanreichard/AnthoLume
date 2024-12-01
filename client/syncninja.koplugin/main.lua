local ConfirmBox = require("ui/widget/confirmbox")
local DataStorage = require("datastorage")
local Device = require("device")
local DocSettings = require("docsettings")
local InfoMessage = require("ui/widget/infomessage")
local MultiInputDialog = require("ui/widget/multiinputdialog")
local NetworkMgr = require("ui/network/manager")
local ReadHistory = require("readhistory")
local SQ3 = require("lua-ljsqlite3/init")
local T = require("ffi/util").template
local UIManager = require("ui/uimanager")
local WidgetContainer = require("ui/widget/container/widgetcontainer")
local _ = require("gettext")
local logger = require("logger")
local md5 = require("ffi/sha2").md5
local random = require("random")

------------------------------------------
------------ Helper Functions ------------
------------------------------------------
local function dump(o)
	if type(o) == "table" then
		local s = "{ "
		for k, v in pairs(o) do
			if type(k) ~= "number" then
				k = '"' .. k .. '"'
			end
			s = s .. "[" .. k .. "] = " .. dump(v) .. ","
		end
		return s .. "} "
	else
		return tostring(o)
	end
end

local function validate(entry)
	if not entry then
		return false
	end
	if type(entry) == "string" then
		if entry == "" or not entry:match("%S") then
			return false
		end
	end
	return true
end

local function validateUser(user, pass)
	local error_message = nil
	local user_ok = validate(user)
	local pass_ok = validate(pass)
	if not user_ok and not pass_ok then
		error_message = _("invalid username and password")
	elseif not user_ok then
		error_message = _("invalid username")
	elseif not pass_ok then
		error_message = _("invalid password")
	end

	if not error_message then
		return user_ok and pass_ok
	else
		return user_ok and pass_ok, error_message
	end
end

------------------------------------------
-------------- Plugin Start --------------
------------------------------------------
local MERGE_SETTINGS_IN = "IN"
local MERGE_SETTINGS_OUT = "OUT"

local STATISTICS_ACTIVITY_SINCE_QUERY = [[
    SELECT
	b.md5 AS document,
	psd.start_time AS start_time,
	psd.duration AS duration,
	psd.page AS current_page,
	psd.total_pages
    FROM page_stat_data AS psd
    JOIN book AS b
    ON b.id = psd.id_book
    WHERE start_time > %d
    ORDER BY start_time ASC LIMIT 5000;
]]

local STATISTICS_BOOK_QUERY = [[
    SELECT
	md5,
	title,
	authors,
	series,
	language
      FROM book;
]]

local BOOKINFO_BOOK_QUERY = [[
    SELECT
	(directory || filename) as filepath,
	title,
	authors,
	series,
	series_index,
	language,
	description
    FROM bookinfo;
]]

-- Validate Device ID Exists
if G_reader_settings:hasNot("device_id") then
	G_reader_settings:saveSetting("device_id", random.uuid())
end

-- Define DB Location
local statistics_db = DataStorage:getSettingsDir() .. "/statistics.sqlite3"
local bookinfo_db = DataStorage:getSettingsDir() .. "/bookinfo_cache.sqlite3"

local SyncNinja = WidgetContainer:extend({
	name = "syncninja",
	settings = nil,
	is_doc_only = false,
})

SyncNinja.default_settings = {
	server = nil,
	username = nil,
	password = nil,
	sync_frequency = 30,
	sync_activity = true,
	sync_documents = true,
	sync_document_files = true,
}

function SyncNinja:init()
	logger.dbg("SyncNinja: init")

	-- Instance Specific (Non Interactive)
	self.periodic_push_task = function()
		self:performSync(false)
	end

	-- Load Settings
	self.device_id = G_reader_settings:readSetting("device_id")
	self.settings = G_reader_settings:readSetting("syncninja", self.default_settings)

	-- Register Menu Items
	self.ui.menu:registerToMainMenu(self)

	-- Initial Periodic Push Schedule (5 Minutes)
	self:schedulePeriodicPush(5)
end

------------------------------------------
-------------- UX Functions --------------
------------------------------------------
function SyncNinja:addToMainMenu(menu_items)
	logger.dbg("SyncNinja: addToMainMenu")
	menu_items.syncninja = {
		text = _("Sync Ninja"),
		sorting_hint = "tools",
		sub_item_table = {
			{
				text = _("Sync Server"),
				keep_menu_open = true,
				tap_input_func = function(menu)
					return {
						title = _("Sync server address"),
						input = self.settings.server or "https://",
						type = "text",
						callback = function(input)
							self.settings.server = input ~= "" and input or nil
							if menu then
								menu:updateItems()
							end
						end,
					}
				end,
			},
			{
				text_func = function()
					return self.settings.password and (_("Logout")) or _("Register") .. " / " .. _("Login")
				end,
				enabled_func = function()
					return self.settings.server ~= nil
				end,
				keep_menu_open = true,
				callback_func = function()
					if self.settings.password then
						return function(menu)
							self:logoutUI(menu)
						end
					else
						return function(menu)
							self:loginUI(menu)
						end
					end
				end,
			},
			{
				text = _("Manual Sync"),
				keep_menu_open = true,
				enabled_func = function()
					return self.settings.password ~= nil
						and self.settings.username ~= nil
						and self.settings.server ~= nil
				end,
				callback = function()
					UIManager:unschedule(self.performSync)
					self:performSync(true) -- Interactive
				end,
			},
			{
				text = _("KOSync Auth Merge"),
				sub_item_table = {
					{
						text = _("KOSync Merge In"),
						keep_menu_open = true,
						callback = function()
							self:mergeKOSync(MERGE_SETTINGS_IN)
						end,
					},
					{
						text = _("KOSync Merge Out"),
						keep_menu_open = true,
						callback = function()
							self:mergeKOSync(MERGE_SETTINGS_OUT)
						end,
					},
				},
				separator = true,
			},
			{
				text_func = function()
					return T(_("Sync Frequency (%1 Minutes)"), self.settings.sync_frequency or 30)
				end,
				keep_menu_open = true,
				callback = function(touchmenu_instance)
					local SpinWidget = require("ui/widget/spinwidget")
					local items = SpinWidget:new({
						text = _([[This value determines the cadence at which the syncs will be performed.
If set to 0, periodic sync will be disabled.]]),
						value = self.settings.sync_frequency or 30,
						value_min = 0,
						value_max = 1440,
						value_step = 30,
						value_hold_step = 60,
						ok_text = _("Set"),
						title_text = _("Minutes between syncs"),
						default_value = 30,
						callback = function(spin)
							self.settings.sync_frequency = spin.value > 0 and spin.value or 30
							if touchmenu_instance then
								touchmenu_instance:updateItems()
							end
							self:schedulePeriodicPush()
						end,
					})
					UIManager:show(items)
				end,
			},
			{
				text_func = function()
					return T(
						_("Sync Activity (%1)"),
						self.settings.sync_activity == true and (_("Enabled")) or (_("Disabled"))
					)
				end,
				sub_item_table = {
					{
						text = _("Enabled"),
						checked_func = function()
							return self.settings.sync_activity == true
						end,
						callback = function()
							self.settings.sync_activity = true
						end,
					},
					{
						text = _("Disabled"),
						checked_func = function()
							return self.settings.sync_activity ~= true
						end,
						callback = function()
							self.settings.sync_activity = false
						end,
					},
				},
			},
			{
				text_func = function()
					return T(
						_("Sync Documents (%1)"),
						self.settings.sync_documents == true and (_("Enabled")) or (_("Disabled"))
					)
				end,
				sub_item_table = {
					{
						text = _("Enabled"),
						checked_func = function()
							return self.settings.sync_documents == true
						end,
						callback = function()
							self.settings.sync_documents = true
						end,
					},
					{
						text = _("Disabled"),
						checked_func = function()
							return self.settings.sync_documents ~= true
						end,
						callback = function()
							self.settings.sync_documents = false
						end,
					},
				},
			},
			{
				text_func = function()
					return T(
						_("Sync Document Files (%1)"),
						self.settings.sync_documents == true
								and self.settings.sync_document_files == true
								and (_("Enabled"))
							or (_("Disabled"))
					)
				end,
				enabled_func = function()
					return self.settings.sync_documents == true
				end,
				sub_item_table = {
					{
						text = _("Enabled"),
						checked_func = function()
							return self.settings.sync_document_files == true
						end,
						callback = function()
							self.settings.sync_document_files = true
						end,
					},
					{
						text = _("Disabled"),
						checked_func = function()
							return self.settings.sync_document_files ~= true
						end,
						callback = function()
							self.settings.sync_document_files = false
						end,
					},
				},
			},
		},
	}
end

function SyncNinja:loginUI(menu)
	logger.dbg("SyncNinja: loginUI")
	if NetworkMgr:willRerunWhenOnline(function()
		self:loginUI(menu)
	end) then
		return
	end

	local dialog
	dialog = MultiInputDialog:new({
		title = _("Register/login to SyncNinja server"),
		fields = {
			{ text = self.settings.username, hint = "username" },
			{ hint = "password", text_type = "password" },
		},
		buttons = {
			{
				{
					text = _("Cancel"),
					id = "close",
					callback = function()
						UIManager:close(dialog)
					end,
				},
				{
					text = _("Login"),
					callback = function()
						local username, password = unpack(dialog:getFields())
						local ok, err = validateUser(username, password)
						if not ok then
							UIManager:show(InfoMessage:new({
								text = T(_("Cannot login: %1"), err),
								timeout = 2,
							}))
						else
							UIManager:close(dialog)
							UIManager:scheduleIn(0.5, function()
								self:userLogin(username, password, menu)
							end)
							UIManager:show(InfoMessage:new({
								text = _("Logging in. Please wait…"),
								timeout = 1,
							}))
						end
					end,
				},
				{
					text = _("Register"),
					callback = function()
						local username, password = unpack(dialog:getFields())
						local ok, err = validateUser(username, password)
						if not ok then
							UIManager:show(InfoMessage:new({
								text = T(_("Cannot register: %1"), err),
								timeout = 2,
							}))
						else
							UIManager:close(dialog)
							UIManager:scheduleIn(0.5, function()
								self:userRegister(username, password, menu)
							end)
							UIManager:show(InfoMessage:new({
								text = _("Registering. Please wait…"),
								timeout = 1,
							}))
						end
					end,
				},
			},
		},
	})
	UIManager:show(dialog)
	dialog:onShowKeyboard()
end

function SyncNinja:logoutUI(menu)
	logger.dbg("SyncNinja: logoutUI")
	self.settings.username = nil
	self.settings.password = nil
	if menu then
		menu:updateItems()
	end
	UIManager:unschedule(self.periodic_push_task)
end

function SyncNinja:mergeKOSync(direction)
	logger.dbg("SyncNinja: mergeKOSync")
	local kosync_settings = G_reader_settings:readSetting("kosync")
	if kosync_settings == nil then
		return
	end

	if direction == MERGE_SETTINGS_OUT then
		-- Validate Configured
		if not self.settings.server or not self.settings.username or not self.settings.password then
			return UIManager:show(InfoMessage:new({
				text = _("Error: SyncNinja not configured"),
			}))
		end

		kosync_settings.custom_server = self.settings.server
			.. (self.settings.server:sub(-#"/") == "/" and "api/ko" or "/api/ko")
		kosync_settings.username = self.settings.username
		kosync_settings.userkey = self.settings.password

		UIManager:show(InfoMessage:new({ text = _("Synced to KOSync") }))
	elseif direction == MERGE_SETTINGS_IN then
		-- Validate Configured
		if not kosync_settings.custom_server or not kosync_settings.username or not kosync_settings.userkey then
			return UIManager:show(InfoMessage:new({
				text = _("Error: KOSync not configured"),
			}))
		end

		-- Validate Compatible Server
		if
			kosync_settings.custom_server:sub(-#"/api/ko") ~= "/api/ko"
			and kosync_settings.custom_server:sub(-#"/api/ko/") ~= "/api/ko/"
		then
			return UIManager:show(InfoMessage:new({
				text = _("Error: Configured KOSync server not compatible"),
			}))
		end

		self.settings.server = string.gsub(kosync_settings.custom_server, "/api/ko/?$", "")
		self.settings.username = kosync_settings.username
		self.settings.password = kosync_settings.userkey

		UIManager:show(InfoMessage:new({ text = _("Synced from KOSync") }))
	end
end

------------------------------------------
------------- Login Functions ------------
------------------------------------------
function SyncNinja:userLogin(username, password, menu)
	logger.dbg("SyncNinja: userLogin")
	if not self.settings.server then
		return
	end

	local SyncNinjaClient = require("SyncNinjaClient")
	local client = SyncNinjaClient:new({
		custom_url = self.settings.server,
		service_spec = self.path .. "/api.json",
	})
	Device:setIgnoreInput(true)
	local userkey = md5(password)
	local ok, status, body = pcall(client.authorize, client, username, userkey)
	if not ok then
		if status then
			UIManager:show(InfoMessage:new({
				text = _("An error occurred while logging in:") .. "\n" .. status,
			}))
		else
			UIManager:show(InfoMessage:new({
				text = _("An unknown error occurred while logging in."),
			}))
		end
		Device:setIgnoreInput(false)
		return
	elseif status then
		self.settings.username = username
		self.settings.password = userkey
		if menu then
			menu:updateItems()
		end
		UIManager:show(InfoMessage:new({
			text = _("Logged in to AnthoLume server."),
		}))

		self:schedulePeriodicPush(0)
	else
		logger.dbg("SyncNinja: userLogin Error:", dump(body))
	end
	Device:setIgnoreInput(false)
end

function SyncNinja:userRegister(username, password, menu)
	logger.dbg("SyncNinja: userRegister")
	if not self.settings.server then
		return
	end

	local SyncNinjaClient = require("SyncNinjaClient")
	local client = SyncNinjaClient:new({
		custom_url = self.settings.server,
		service_spec = self.path .. "/api.json",
	})
	-- on Android to avoid ANR (no-op on other platforms)
	Device:setIgnoreInput(true)
	local userkey = md5(password)
	local ok, status, body = pcall(client.register, client, username, userkey)
	if not ok then
		if status then
			UIManager:show(InfoMessage:new({
				text = _("An error occurred while registering:") .. "\n" .. status,
			}))
		else
			UIManager:show(InfoMessage:new({
				text = _("An unknown error occurred while registering."),
			}))
		end
	elseif status then
		self.settings.username = username
		self.settings.password = userkey
		if menu then
			menu:updateItems()
		end
		UIManager:show(InfoMessage:new({
			text = _("Registered to AnthoLume server."),
		}))

		self:schedulePeriodicPush(0)
	else
		UIManager:show(InfoMessage:new({
			text = body and body.message or _("Unknown server error"),
		}))
	end
	Device:setIgnoreInput(false)
end

------------------------------------------
------------- Sync Functions -------------
------------------------------------------
function SyncNinja:schedulePeriodicPush(minutes)
	logger.dbg("SyncNinja: schedulePeriodicPush")

	-- Validate Configured
	if not self.settings then
		return
	end
	if not self.settings.username then
		return
	end
	if not self.settings.password then
		return
	end
	if not self.settings.server then
		return
	end

	-- Unschedule & Schedule
	local sync_frequency = minutes or self.settings.sync_frequency or 30
	UIManager:unschedule(self.periodic_push_task)
	UIManager:scheduleIn(60 * sync_frequency, self.periodic_push_task)
end

function SyncNinja:performSync(interactive)
	logger.dbg("SyncNinja: performSync")

	-- Notify
	if interactive == true then
		UIManager:show(InfoMessage:new({
			text = _("SyncNinja: Manual Sync Initiated"),
			timeout = 3,
		}))
	end

	-- Upload Activity & Check Documents
	self:checkActivity(interactive)
	self:checkDocuments(interactive)

	-- Schedule Push Again
	self:schedulePeriodicPush()
end

function SyncNinja:checkActivity(interactive)
	logger.dbg("SyncNinja: checkActivity")

	-- Ensure Activity Sync Enabled
	if self.settings.sync_activity ~= true then
		return
	end

	-- API Callback Function
	local callback_func = function(ok, body)
		if not ok then
			if interactive == true then
				UIManager:show(InfoMessage:new({
					text = _("SyncNinja: checkActivity Error"),
					timeout = 3,
				}))
			end
			return logger.dbg("SyncNinja: checkActivity Error:", dump(body))
		end

		local last_sync = body.last_sync
		local activity_data = self:getStatisticsActivity(last_sync)

		-- Activity Data Exists
		if not (next(activity_data) == nil) then
			self:uploadActivity(activity_data, interactive)
		end
	end

	-- API Call
	local SyncNinjaClient = require("SyncNinjaClient")
	local client = SyncNinjaClient:new({
		custom_url = self.settings.server,
		service_spec = self.path .. "/api.json",
	})
	local ok, err = pcall(
		client.check_activity,
		client,
		self.settings.username,
		self.settings.password,
		self.device_id,
		Device.model,
		callback_func
	)
end

function SyncNinja:uploadActivity(activity_data, interactive)
	logger.dbg("SyncNinja: uploadActivity")

	-- API Callback Function
	local callback_func = function(ok, body)
		if not ok then
			if interactive == true then
				UIManager:show(InfoMessage:new({
					text = _("SyncNinja: uploadActivity Error"),
					timeout = 3,
				}))
			end
			return logger.dbg("SyncNinja: uploadActivity Error:", dump(body))
		end
	end

	-- API Call
	local SyncNinjaClient = require("SyncNinjaClient")
	local client = SyncNinjaClient:new({
		custom_url = self.settings.server,
		service_spec = self.path .. "/api.json",
	})
	local ok, err = pcall(
		client.add_activity,
		client,
		self.settings.username,
		self.settings.password,
		self.device_id,
		Device.model,
		activity_data,
		callback_func
	)
end

function SyncNinja:checkDocuments(interactive)
	logger.dbg("SyncNinja: checkDocuments")

	-- Ensure Document Sync Enabled
	if self.settings.sync_documents ~= true then
		return
	end

	-- API Request Data
	local doc_metadata = self:getLocalDocumentMetadata()
	local doc_ids = self:getLocalDocumentIDs(doc_metadata)

	-- API Callback Function
	local callback_func = function(ok, body)
		if not ok then
			if interactive == true then
				UIManager:show(InfoMessage:new({
					text = _("SyncNinja: checkDocuments Error"),
					timeout = 3,
				}))
			end
			return logger.dbg("SyncNinja: checkDocuments Error:", dump(body))
		end

		-- Document Metadata Wanted
		if not (next(body.want_metadata) == nil) then
			local hash_want_metadata = {}
			for _, v in pairs(body.want_metadata) do
				hash_want_metadata[v] = true
			end

			local upload_doc_metadata = {}
			for _, v in pairs(doc_metadata) do
				if hash_want_metadata[v.id] == true then
					table.insert(upload_doc_metadata, v)
				end
			end

			self:uploadDocumentMetadata(upload_doc_metadata, interactive)
		end

		-- Document Files Wanted
		if not (next(body.want_files) == nil) then
			local hash_want_files = {}
			for _, v in pairs(body.want_files) do
				hash_want_files[v] = true
			end

			local upload_doc_files = {}
			for _, v in pairs(doc_metadata) do
				if hash_want_files[v.id] == true then
					table.insert(upload_doc_files, v)
				end
			end

			self:uploadDocumentFiles(upload_doc_files, interactive)
		end

		-- Documents Provided
		if not (next(body.give) == nil) then
			self:downloadDocuments(body.give, interactive)
		end
	end

	-- API Call
	local SyncNinjaClient = require("SyncNinjaClient")
	local client = SyncNinjaClient:new({
		custom_url = self.settings.server,
		service_spec = self.path .. "/api.json",
	})
	local ok, err = pcall(
		client.check_documents,
		client,
		self.settings.username,
		self.settings.password,
		self.device_id,
		Device.model,
		doc_ids,
		callback_func
	)
end

function SyncNinja:downloadDocuments(doc_metadata, interactive)
	logger.dbg("SyncNinja: downloadDocuments")

	-- TODO
	--   - OPDS Sufficient?
	--   - Auto Configure OPDS?
end

function SyncNinja:uploadDocumentMetadata(doc_metadata, interactive)
	logger.dbg("SyncNinja: uploadDocumentMetadata")

	-- Ensure Document Sync Enabled
	if self.settings.sync_documents ~= true then
		return
	end

	-- API Callback Function
	local callback_func = function(ok, body)
		if not ok then
			if interactive == true then
				UIManager:show(InfoMessage:new({
					text = _("SyncNinja: uploadDocumentMetadata Error"),
					timeout = 3,
				}))
			end
			return logger.dbg("SyncNinja: uploadDocumentMetadata Error:", dump(body))
		end
	end

	-- API Client
	local SyncNinjaClient = require("SyncNinjaClient")
	local client = SyncNinjaClient:new({
		custom_url = self.settings.server,
		service_spec = self.path .. "/api.json",
	})

	-- API Initial Metadata
	local ok, err =
		pcall(client.add_documents, client, self.settings.username, self.settings.password, doc_metadata, callback_func)
end

function SyncNinja:uploadDocumentFiles(doc_metadata, interactive)
	logger.dbg("SyncNinja: uploadDocumentFiles")

	-- Ensure Document File Sync Enabled
	if self.settings.sync_document_files ~= true then
		return
	end
	if interactive ~= true then
		return
	end

	local callback_func = function(ok, body)
		if not ok then
			UIManager:show(InfoMessage:new({
				text = _("SyncNinja: uploadDocumentFiles Error"),
				timeout = 3,
			}))
			return logger.dbg("SyncNinja: uploadDocumentFiles Error:", dump(body))
		end
	end

	-- API File Upload
	local confirm_upload_callback = function()
		UIManager:show(InfoMessage:new({
			text = _("Uploading Documents - Please Wait..."),
		}))

		UIManager:nextTick(function()
			-- API Client
			local SyncNinjaClient = require("SyncNinjaClient")
			local client = SyncNinjaClient:new({
				custom_url = self.settings.server,
				service_spec = self.path .. "/api.json",
			})

			for _, v in pairs(doc_metadata) do
				if v.filepath ~= nil then
					local ok, err = pcall(
						client.upload_document,
						client,
						self.settings.username,
						self.settings.password,
						v.id,
						v.filepath,
						callback_func
					)
				else
					logger.dbg("SyncNinja: uploadDocumentFiles - no file for:", v.id)
				end
			end

			UIManager:show(InfoMessage:new({
				text = _("Uploading Documents Complete"),
			}))
		end)
	end

	UIManager:show(ConfirmBox:new({
		text = _("Upload documents? This can take awhile."),
		ok_text = _("Yes"),
		ok_callback = confirm_upload_callback,
	}))
end

------------------------------------------
------------ Getter Functions ------------
------------------------------------------
function SyncNinja:getLocalDocumentIDs(doc_metadata)
	logger.dbg("SyncNinja: getLocalDocumentIDs")

	local document_ids = {}

	if doc_metadata == nil then
		doc_metadata = self:getLocalDocumentMetadata()
	end

	for _, v in pairs(doc_metadata) do
		table.insert(document_ids, v.id)
	end

	return document_ids
end

function SyncNinja:getLocalDocumentMetadata()
	logger.dbg("SyncNinja: getLocalDocumentMetadata")

	local all_documents = {}

	local documents_kv = self:getStatisticsBookKV()
	local bookinfo_books = self:getBookInfoBookKV()

	for _, v in pairs(ReadHistory.hist) do
		if DocSettings:hasSidecarFile(v.file) then
			local docsettings = DocSettings:open(v.file)

			-- Ensure Partial MD5 Exists
			local pmd5 = docsettings:readSetting("partial_md5_checksum")
			if not pmd5 then
				pmd5 = self:getPartialMd5(v.file)
				docsettings:saveSetting("partial_md5_checksum", pmd5)
			end

			-- Get Document Props & Ensure Not Nil
			local doc_props = docsettings:readSetting("doc_props") or {}
			local fdoc = bookinfo_books[v.file] or {}

			-- Update or Create
			if documents_kv[pmd5] ~= nil then
				local doc = documents_kv[pmd5]

				-- Merge Statistics, History, and BookInfo
				doc.title = doc.title or doc_props.title or fdoc.title
				doc.author = doc.author or doc_props.authors or fdoc.author
				doc.series = doc.series or doc_props.series or fdoc.series
				doc.lang = doc.lang or doc_props.language or fdoc.lang

				-- Merge History and BookInfo
				doc.series_index = doc_props.series_index or fdoc.series_index
				doc.description = doc_props.description or fdoc.description
				doc.filepath = v.file
			else
				-- Merge History and BookInfo
				documents_kv[pmd5] = {
					title = doc_props.title or fdoc.title,
					author = doc_props.authors or fdoc.author,
					series = doc_props.series or fdoc.series,
					series_index = doc_props.series_index or fdoc.series_index,
					lang = doc_props.language or fdoc.lang,
					description = doc_props.description or fdoc.description,
					filepath = v.file,
				}
			end
		end
	end

	-- Convert KV -> Array
	for pmd5, v in pairs(documents_kv) do
		table.insert(all_documents, {
			id = pmd5,
			title = v.title,
			author = v.author,
			series = v.series,
			series_index = v.series_index,
			lang = v.lang,
			description = v.description,
			filepath = v.filepath,
		})
	end

	return all_documents
end

function SyncNinja:getStatisticsActivity(timestamp)
	logger.dbg("SyncNinja: getStatisticsActivity")

	local all_data = {}
	local conn = SQ3.open(statistics_db)
	local stmt = conn:prepare(string.format(STATISTICS_ACTIVITY_SINCE_QUERY, timestamp))
	local rows = stmt:resultset("i", 5000)
	conn:close()

	-- No Results
	if rows == nil then
		return all_data
	end

	-- Normalize
	for i, v in pairs(rows[1]) do
		table.insert(all_data, {
			document = rows[1][i],
			start_time = tonumber(rows[2][i]),
			duration = tonumber(rows[3][i]),
			page = tonumber(rows[4][i]),
			pages = tonumber(rows[5][i]),
		})
	end

	return all_data
end

-- Returns KEY:VAL (MD5:<TABLE>)
function SyncNinja:getStatisticsBookKV()
	logger.dbg("SyncNinja: getStatisticsBookKV")

	local all_data = {}
	local conn = SQ3.open(statistics_db)
	local stmt = conn:prepare(STATISTICS_BOOK_QUERY)
	local rows = stmt:resultset("i", 1000)
	conn:close()

	-- No Results
	if rows == nil then
		return all_data
	end

	-- Normalize
	for i, v in pairs(rows[1]) do
		local pmd5 = rows[1][i]
		all_data[pmd5] = {
			title = rows[2][i],
			author = rows[3][i],
			series = rows[4][i],
			lang = rows[5][i],
		}
	end

	return all_data
end

-- Returns KEY:VAL (FILEPATH:<TABLE>)
function SyncNinja:getBookInfoBookKV()
	logger.dbg("SyncNinja: getBookInfoBookKV")

	local all_data = {}
	local conn = SQ3.open(bookinfo_db)
	local stmt = conn:prepare(BOOKINFO_BOOK_QUERY)
	local rows = stmt:resultset("i", 1000)
	conn:close()

	-- No Results
	if rows == nil then
		return all_data
	end

	-- Normalize
	for i, v in pairs(rows[1]) do
		filepath = rows[1][i]
		all_data[filepath] = {
			title = rows[2][i],
			author = rows[3][i],
			series = rows[4][i],
			series_index = tonumber(rows[5][i]),
			lang = rows[6][i],
			description = rows[7][i],
		}
	end

	return all_data
end

function SyncNinja:getPartialMd5(file)
	logger.dbg("SyncNinja: getPartialMd5")

	if file == nil then
		return nil
	end
	local bit = require("bit")
	local lshift = bit.lshift
	local step, size = 1024, 1024
	local update = md5()
	local file_handle = io.open(file, "rb")
	if file_handle == nil then
		return nil
	end
	for i = -1, 10 do
		file_handle:seek("set", lshift(step, 2 * i))
		local sample = file_handle:read(size)
		if sample then
			update(sample)
		else
			break
		end
	end
	file_handle:close()
	return update()
end

return SyncNinja
