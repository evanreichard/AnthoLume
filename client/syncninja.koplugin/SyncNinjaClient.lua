local UIManager = require("ui/uimanager")
local http = require("socket.http")
local lfs = require("libs/libkoreader-lfs")
local logger = require("logger")
local ltn12 = require("ltn12")
local socket = require("socket")
local socketutil = require("socketutil")

-- Push/Pull
local SYNC_TIMEOUTS = {2, 5}

-- Login/Register
local AUTH_TIMEOUTS = {5, 10}

local SyncNinjaClient = {service_spec = nil, custom_url = nil}

function SyncNinjaClient:new(o)
    if o == nil then o = {} end
    setmetatable(o, self)
    self.__index = self
    if o.init then o:init() end
    return o
end

function SyncNinjaClient:init()
    local Spore = require("Spore")
    self.client = Spore.new_from_spec(self.service_spec,
                                      {base_url = self.custom_url})
    package.loaded["Spore.Middleware.GinClient"] = {}
    require("Spore.Middleware.GinClient").call = function(_, req)
        req.headers["accept"] = "application/vnd.koreader.v1+json"
    end
    package.loaded["Spore.Middleware.SyncNinjaAuth"] = {}
    require("Spore.Middleware.SyncNinjaAuth").call = function(args, req)
        req.headers["x-auth-user"] = args.username
        req.headers["x-auth-key"] = args.userkey
    end
    package.loaded["Spore.Middleware.AsyncHTTP"] = {}
    require("Spore.Middleware.AsyncHTTP").call = function(args, req)
        -- disable async http if Turbo looper is missing
        if not UIManager.looper then return end
        req:finalize()
        local result

        local turbo = require("turbo")
        turbo.log.categories.success = false
        turbo.log.categories.warning = false

        local client = turbo.async.HTTPClient({verify_ca = false})
        local res = coroutine.yield(client:fetch(request.url, {
            url = req.url,
            method = req.method,
            body = req.env.spore.payload,
            connect_timeout = 10,
            request_timeout = 20,
            on_headers = function(headers)
                for header, value in pairs(req.headers) do
                    if type(header) == "string" then
                        headers:add(header, value)
                    end
                end
            end
        }))

        return res

        -- return coroutine.create(function() coroutine.yield(result) end)
    end
end

------------------------------------------
-------------- New Functions -------------
------------------------------------------

function SyncNinjaClient:check_activity(username, password, device_id, device,
                                        callback)
    self.client:reset_middlewares()
    self.client:enable("Format.JSON")
    self.client:enable("GinClient")
    self.client:enable("SyncNinjaAuth",
                       {username = username, userkey = password})

    socketutil:set_timeout(SYNC_TIMEOUTS[1], SYNC_TIMEOUTS[2])
    local co = coroutine.create(function()
        local ok, res = pcall(function()
            return self.client:check_activity({
                device_id = device_id,
                device = device
            })
        end)
        if ok then
            callback(res.status == 200, res.body)
        else
            logger.dbg("SyncNinjaClient:check_activity failure:", res)
            callback(false, res.body)
        end
    end)
    self.client:enable("AsyncHTTP", {thread = co})
    coroutine.resume(co)
    if UIManager.looper then UIManager:setInputTimeout() end
    socketutil:reset_timeout()
end

function SyncNinjaClient:add_activity(username, password, device_id, device,
                                      activity, callback)
    self.client:reset_middlewares()
    self.client:enable("Format.JSON")
    self.client:enable("GinClient")
    self.client:enable("SyncNinjaAuth",
                       {username = username, userkey = password})

    socketutil:set_timeout(SYNC_TIMEOUTS[1], SYNC_TIMEOUTS[2])
    local co = coroutine.create(function()
        local ok, res = pcall(function()
            return self.client:add_activity({
                device_id = device_id,
                device = device,
                activity = activity
            })
        end)

        if ok then
            callback(res.status == 200, res.body)
        else
            logger.dbg("SyncNinjaClient:add_activity failure:", res)
            callback(false, res.body)
        end
    end)
    self.client:enable("AsyncHTTP", {thread = co})
    coroutine.resume(co)
    if UIManager.looper then UIManager:setInputTimeout() end
    socketutil:reset_timeout()
end

function SyncNinjaClient:add_documents(username, password, documents, callback)
    self.client:reset_middlewares()
    self.client:enable("Format.JSON")
    self.client:enable("GinClient")
    self.client:enable("SyncNinjaAuth",
                       {username = username, userkey = password})

    socketutil:set_timeout(SYNC_TIMEOUTS[1], SYNC_TIMEOUTS[2])
    local co = coroutine.create(function()
        local ok, res = pcall(function()
            return self.client:add_documents({documents = documents})
        end)
        if ok then
            callback(res.status == 200, res.body)
        else
            logger.dbg("SyncNinjaClient:add_documents failure:", res)(
                "SyncNinjaClient:add_documents failure:", res)
            callback(false, res.body)
        end
    end)
    self.client:enable("AsyncHTTP", {thread = co})
    coroutine.resume(co)
    if UIManager.looper then UIManager:setInputTimeout() end
    socketutil:reset_timeout()
end

function SyncNinjaClient:check_documents(username, password, device_id, device,
                                         have, callback)
    self.client:reset_middlewares()
    self.client:enable("Format.JSON")
    self.client:enable("GinClient")
    self.client:enable("SyncNinjaAuth",
                       {username = username, userkey = password})

    socketutil:set_timeout(SYNC_TIMEOUTS[1], SYNC_TIMEOUTS[2])
    local co = coroutine.create(function()
        local ok, res = pcall(function()
            return self.client:check_documents({
                device_id = device_id,
                device = device,
                have = have
            })
        end)
        if ok then
            callback(res.status == 200, res.body)
        else
            logger.dbg("SyncNinjaClient:check_documents failure:", res)
            callback(false, res.body)
        end
    end)
    self.client:enable("AsyncHTTP", {thread = co})
    coroutine.resume(co)
    if UIManager.looper then UIManager:setInputTimeout() end
    socketutil:reset_timeout()
end

function SyncNinjaClient:download_document(username, password, document,
                                           callback)
    self.client:reset_middlewares()
    self.client:enable("Format.JSON")
    self.client:enable("GinClient")
    self.client:enable("SyncNinjaAuth",
                       {username = username, userkey = password})

    local ok, res = pcall(function()
        return self.client:download_document({document = document})
    end)
    if ok then
        callback(res.status == 200, res.body)
    else
        logger.dbg("SyncNinjaClient:download_document failure:", res)
        callback(false, res.body)
    end
end

function SyncNinjaClient:upload_document(username, password, document, filepath,
                                         callback)
    -- Create URL
    local url = self.custom_url ..
                    (self.custom_url:sub(-#"/") ~= "/" and "/" or "") ..
                    "api/ko/documents/" .. document .. "/file"

    -- Track Length, Sources, and Boundary
    local len = 0
    local sources = {}
    local boundary = "-----BoundaryePkpFF7tjBAqx29L"

    -- Open File & Get Size
    local file = io.open(filepath, "rb")
    local file_size = lfs.attributes(filepath, 'size')

    -- Insert File Start
    local str_start = {}
    table.insert(str_start, "--" .. boundary .. "\r\n")
    table.insert(str_start, 'content-disposition: form-data; name="file";')
    table.insert(str_start, 'filename="' .. "test" ..
                     '"\r\ncontent-type: application/octet-stream\r\n\r\n')
    str_start = table.concat(str_start)
    table.insert(sources, ltn12.source.string(str_start))
    len = len + #str_start

    -- Insert File
    table.insert(sources, ltn12.source.file(file))
    len = len + file_size

    -- Insert File End
    local str_end = "\r\n"
    table.insert(sources, ltn12.source.string(str_end))
    len = len + #str_end

    -- Insert Multipart End
    local str = string.format("--%s--\r\n", boundary)
    table.insert(sources, ltn12.source.string(str))
    len = len + #str

    -- Execute Request
    logger.dbg("SyncNinja: upload_document - Uploading [" .. len .. "]:",
               filepath)

    local resp = {}
    local code, headers, status = socket.skip(1, http.request {
        url = url,
        method = 'PUT',
        headers = {
            ["Content-Length"] = len,
            ['Content-Type'] = "multipart/form-data; boundary=" .. boundary,
            ['X-Auth-User'] = username,
            ['X-Auth-Key'] = password
        },
        source = ltn12.source.cat(unpack(sources)),
        sink = ltn12.sink.table(resp)
    })

    if code ~= 200 then
        logger.dbg("SyncNinjaClient:upload_document failure:", res)
    end
    callback(code == 200, resp)
end

------------------------------------------
----------- Existing Functions -----------
------------------------------------------

function SyncNinjaClient:register(username, password)
    self.client:reset_middlewares()
    self.client:enable("Format.JSON")
    self.client:enable("GinClient")
    socketutil:set_timeout(AUTH_TIMEOUTS[1], AUTH_TIMEOUTS[2])
    local ok, res = pcall(function()
        return self.client:register({username = username, password = password})
    end)
    socketutil:reset_timeout()
    if ok then
        return res.status == 201, res.body
    else
        logger.dbg("SyncNinjaClient:register failure:", res)
        return false, res.body
    end
end

function SyncNinjaClient:authorize(username, password)
    self.client:reset_middlewares()
    self.client:enable("Format.JSON")
    self.client:enable("GinClient")
    self.client:enable("SyncNinjaAuth",
                       {username = username, userkey = password})
    socketutil:set_timeout(AUTH_TIMEOUTS[1], AUTH_TIMEOUTS[2])
    local ok, res = pcall(function() return self.client:authorize() end)
    socketutil:reset_timeout()
    if ok then
        return res.status == 200, res.body
    else
        logger.dbg("SyncNinjaClient:authorize failure:", res)
        return false, res.body
    end
end

function SyncNinjaClient:update_progress(username, password, document, progress,
                                         percentage, device, device_id, callback)
    self.client:reset_middlewares()
    self.client:enable("Format.JSON")
    self.client:enable("GinClient")
    self.client:enable("SyncNinjaAuth",
                       {username = username, userkey = password})

    socketutil:set_timeout(SYNC_TIMEOUTS[1], SYNC_TIMEOUTS[2])
    local co = coroutine.create(function()
        local ok, res = pcall(function()
            return self.client:update_progress({
                document = document,
                progress = tostring(progress),
                percentage = percentage,
                device = device,
                device_id = device_id
            })
        end)
        if ok then
            callback(res.status == 200, res.body)
        else
            logger.dbg("SyncNinjaClient:update_progress failure:", res)
            callback(false, res.body)
        end
    end)
    self.client:enable("AsyncHTTP", {thread = co})
    coroutine.resume(co)
    if UIManager.looper then UIManager:setInputTimeout() end
    socketutil:reset_timeout()
end

function SyncNinjaClient:get_progress(username, password, document, callback)
    self.client:reset_middlewares()
    self.client:enable("Format.JSON")
    self.client:enable("GinClient")
    self.client:enable("SyncNinjaAuth",
                       {username = username, userkey = password})

    socketutil:set_timeout(SYNC_TIMEOUTS[1], SYNC_TIMEOUTS[2])
    local co = coroutine.create(function()
        local ok, res = pcall(function()
            return self.client:get_progress({document = document})
        end)
        if ok then
            callback(res.status == 200, res.body)
        else
            logger.dbg("SyncNinjaClient:get_progress failure:", res)
            callback(false, res.body)
        end
    end)
    self.client:enable("AsyncHTTP", {thread = co})
    coroutine.resume(co)
    if UIManager.looper then UIManager:setInputTimeout() end
    socketutil:reset_timeout()
end

return SyncNinjaClient
