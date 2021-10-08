/*!
 * Fresns 微信小程序 (https://fresns.org)
 * Copyright 2021-Present Jarvis Tang
 * Licensed under the Apache-2.0 license
 */
import Api from '../../api/api'
import appConfig from '../../configs/fresnsConfig'
import { globalInfo } from '../../configs/fresnsGlobalInfo'
import { randomStr } from '../../util/randomStr'
import { getPluginSign } from '../../api/tool/sign'

const chooseLocation = requirePlugin('chooseLocation')
/**
 * 帖子、评论
 * @type {{Comment: number, Post: number}}
 */
const Type = {
  Post: 1,
  Comment: 2,
}
/**
 * 创建、编辑
 * @type {{Create: number, Modify: number}}
 */
const Mode = {
  Create: 0,
  Modify: 1,
}

Page({
  mixins: [
    require('../../mixin/themeChanged'),
    require('../../mixin/loginInterceptor'),
  ],
  data: {
    // 是否可以使用编辑器
    isEnable: true,
    // 编辑器类型
    type: Type.Post,
    // 创建还是编辑
    mode: Mode.Create,
    // 编辑帖子或者编辑评论才会携带
    uuid: null,
    // 如果是写评论，此处会有话题 id
    postId: null,

    // 编辑器配置
    editorConfig: null,
    // 是否显示标题
    isShowTitleInput: true,
    // 内容字数长度
    editorContentWordCount: 0,

    // 现在的草稿
    drafts: null,
    // 是否显示草稿选择器
    isShowDraftSelector: false,
    // 当前的草稿
    currentDraft: null,

    // 是否主动选择地址
    manualSelectLocation: false,
    // 禁用词
    stopWords: null,
  },
  editorContext: null,
  updateTimer: null,
  lastPlugin: null,
  onLoad: async function (options) {
    this._parseOptions(options)

    wx.createSelectorQuery().select('#editor').context((res) => {
      this.editorContext = res.context
    }).exec()

    // 拉取编辑器配置数据
    const editorConfigRes = await Api.editor.editorConfigs({
      type: Type.Post,
    })
    if (editorConfigRes.code === 0) {
      this.setData({
        editorConfig: editorConfigRes.data,
      })
    }

    const stopWordsRes = await Api.info.infoStopWords()
    if (stopWordsRes.code === 0) {
      this.setData({
        stopWords: stopWordsRes.data.list,
      })
    }

    await this._authorityCheck()

    // if (this.data.type === Type.Post && !this.data.uuid) {
    //   await this.getDrafts()
    // } else {
    await this._createDraft()
    // }

    // 定时更新
    if (!this.updateTimer) {
      this.updateTimer = setInterval(() => {
        this.updateTitleAndContent()
      }, 10000)
    }

    const location = chooseLocation.getLocation()
    if (location === null || this.data.manualSelectLocation === false) {
      // do nothing
    } else {
      const { name, latitude, longitude, province, city, district, address } = location
      this.data.currentDraft.location = {
        'isLbs': 1,
        'mapId': 5,
        'latitude': latitude,
        'longitude': longitude,
        'scale': null,
        'poi': name,
        'poiId': null,
        'nation': null,
        'province': province,
        'city': city,
        'district': district,
        'adcode': null,
        'address': address,
      }
      await this.updateDraft()
    }
  },
  onUnload: async function () {
    if (this.updateTimer) {
      clearInterval(this.updateTimer)
      this.updateTimer = null
    }
  },
  _parseOptions: function (options) {
    console.log('post editor options:', options)
    const { type, mode, uuid, pid } = options
    if (type === 'post') {
      this.setData({ type: Type.Post })
    }
    if (type === 'comment') {
      this.setData({ type: Type.Comment })
    }

    if (mode === 'create') {
      this.setData({ mode: Mode.Create })
    }
    if (mode === 'modify') {
      this.setData({ mode: Mode.Modify })
    }
    this.setData({ uuid: uuid, postId: pid })
  },
  _authorityCheck: async function () {
    const { editorConfig } = this.data
    // 允许编辑
    if (editorConfig.publishPerm.status) {
      this.setData({ isEnable: true })
    } else {
      const tips = editorConfig.publishPerm.tips
      wx.showToast({
        title: tips?.expired_at || tips?.post_publish || tips?.post_email_verify || tips?.post_phone_verify || tips?.post_prove_verify,
        icon: 'none',
      })
      this.setData({
        isEnable: false,
      })
    }
  },
  _pluginCallback: async function () {
    let { key, uuid } = this.lastPlugin
    this.lastPlugin = null

    const callbackRes = await Api.info.infoCallbacks({
      unikey: key,
      uuid: uuid,
    })
    const contents = callbackRes.data
    contents.forEach(content => {
      const { callbackType, dataValue } = content
      // 6 编辑器-评论附带按钮配置
      if (callbackType === 6) {
        this.data.currentDraft.commentSetting = dataValue
      }

      // 7 编辑器-阅读权限配置
      if (callbackType === 7) {
        this.data.currentDraft.allow = dataValue
      }

      // 8 编辑器-特定成员列表配置
      if (callbackType === 8) {
        this.data.currentDraft.memberList = dataValue
      }

      // 9 编辑器-扩展内容
      if (callbackType === 9) {
        this.data.currentDraft.extends.push(...dataValue)
      }
    })
    await this.updateDraft()
  },
  _createDraft: async function () {
    const { type, uuid, postId } = this.data
    const editorDetailRes = await Api.editor.editorCreate({
      type: type,
      uuid: uuid,
      pid: postId,
    })
    if (editorDetailRes.code === 0) {
      const draftDetail = editorDetailRes.data.detail

      if (editorDetailRes.code === 0) {
        this.setData({
          isShowDraftSelector: false,
          currentDraft: draftDetail,
        })

        this.editorContext.setContents({
          html: draftDetail.content,
        })
      }
    }
  },
  getDrafts: async function () {
    const draftRes = await Api.editor.editorLists({
      type: this.data.type,
      status: 1,
    })
    if (draftRes.code === 0) {
      this.setData({
        isShowDraftSelector: true,
        drafts: draftRes.data.list,
      })
    }
  },
  /**
   * 创建新的草稿
   * @returns {Promise<void>}
   */
  createDraft: async function () {
    const createRes = await Api.editor.editorCreate({
      type: this.data.type,
    })
  },
  /**
   * 当 editor 内容变更时触发
   * @returns {Promise<void>}
   */
  onEditorInput: async function (e) {
    const { text } = e.detail
    this.data.currentDraft.content = text
    this.setData({
      currentDraft: this.data.currentDraft,
      editorContentWordCount: text.replaceAll('\n', '').length,
    })
  },
  /**
   * 更新草稿内容
   * @returns {Promise<void>}
   */
  updateDraft: async function () {
    const { currentDraft } = this.data
    await Api.editor.editorUpdate({
      logType: this.data.type,
      logId: currentDraft.id,
      isPluginEdit: 0,
      pluginUnikey: '',
      // types: '',
      // gid: '',
      title: currentDraft.title,
      content: currentDraft.content,
      isMarkdown: 0,
      isAnonymous: currentDraft.isAnonymous,
      memberListJson: currentDraft.memberList && JSON.stringify(currentDraft.memberList),
      commentSetJson: currentDraft.commentSetting && JSON.stringify(currentDraft.commentSetting),
      allowJson: currentDraft.allow && JSON.stringify(currentDraft.allow),
      locationJson: currentDraft.location && JSON.stringify(currentDraft.location),
      filesJson: currentDraft.files?.length > 0 && JSON.stringify(currentDraft.files),
      extendsJson: currentDraft.extends?.length > 0 && JSON.stringify(currentDraft.extends),
    })

    this.setData({
      currentDraft: this.data.currentDraft,
    })
  },
  /**
   * 定时更新 title 和 content
   * @returns {Promise<void>}
   */
  updateTitleAndContent: async function () {
    const {
      currentDraft,
    } = this.data
    const updateRes = await Api.editor.editorUpdate({
      logType: this.data.type,
      logId: currentDraft.id,
      // type: '',
      // gid: '',
      title: currentDraft.title,
      content: currentDraft.content,
    })
  },
  /**
   * 提交草稿内容
   * @returns {Promise<void>}
   */
  submitDraft: async function () {
    await this.updateDraft()
    // TODO Add stop words check
    const submitRes = await Api.editor.editorSubmit({
      type: this.data.type,
      logId: this.data.currentDraft.id,
    })
    if (submitRes.code === 0) {
      wx.showToast({
        title: '提交成功',
        icon: 'success',
      })
    }
  },
  /**
   * 删除草稿
   */
  deleteDraft: async function () {
    const deleteRes = await Api.editor.editorDelete({
      type: 1,
      logId: this.data.currentDraft.id,
      deleteType: 1,
    })
    if (deleteRes.code === 0) {
      this.setData({
        isShowDraftSelector: true,
        currentDraft: null,
      })
    }
  },
  /**
   * 删除草稿附属文件
   */
  deleteDraftAttachedFile: async function () {
    Api.editor.editorDelete({
      type: 1,
      logId: this.data.currentDraft.id,
      deleteType: 2,
      deleteUuid: '',
    })
  },
  /**
   * 删除扩展内容
   */
  deleteDraftExtension: async function () {
    Api.editor.editorDelete({
      type: 1,
      logId: this.data.currentDraft.id,
      deleteType: 3,
      deleteUuid: '',
    })
  },
  /**
   * 草稿选择
   * @param draft
   */
  onSelectDraft: async function (draft) {
    const editorDetailRes = await Api.editor.editorDetail({
      type: this.data.type,
      logId: draft.id,
    })
    const draftDetail = editorDetailRes.data.detail

    if (editorDetailRes.code === 0) {
      this.setData({
        isShowDraftSelector: false,
        currentDraft: draftDetail,
      })

      this.editorContext.setContents({
        html: draftDetail.content,
      })
    }
  },
  /**
   * 切换显示标题输入框
   */
  switchTitleInputShow: function () {
    this.setData({
      isShowTitleInput: !this.data.isShowTitleInput,
    })
  },
  /**
   * 标题变更
   * @param title
   */
  onTitleChange: function (title) {
    this.data.currentDraft.title = title
    this.setData({
      currentDraft: this.data.currentDraft,
    })
  },
  /**
   * 选择 emoji 表情
   * @param emoji
   */
  onSelectEmoji: function (emoji) {
    this.editorContext.insertText({
      text: `[${emoji.code}]`,
    })
  },
  /**
   * 上传完毕文件的回调
   */
  onAddedFile: async function (file) {
    this.data.currentDraft.files.push(file)
    await this.updateDraft()
  },
  /**
   * 移除文件
   */
  onRemovedFile: async function (fileId) {
    this.data.currentDraft.files = this.data.currentDraft.files.filter(file => file.fid !== fileId)
    await this.updateDraft()
  },
  /**
   * 选择用户
   * @param member
   */
  onSelectMember: function (member) {
    this.editorContext.insertText({
      text: `@${member.nickname} `,
    })
  },
  /**
   * 选择话题
   * @param hashtags
   */
  onSelectHashtags: function (hashtags) {
    let text = `#${hashtags.name} `
    const hashtagShowType = this.data.editorConfig.toolbar.hashtag.showMode
    if (hashtagShowType === 1) {
      text = `#${hashtags.name} `
    }
    if (hashtagShowType === 2) {
      text = `#${hashtags.name}#`
    }
    this.editorContext.insertText({
      text: text,
    })
  },
  /**
   * 点击选择扩展
   */
  onSelectExpand: async function (expand) {
    const uuid = randomStr()

    this.lastPlugin = {
      key: expand.plugin,
      uuid: uuid,
    }

    let url = expand.url
    url.replace('{uuid}', uuid).
      replace('{sign}', await getPluginSign()).
      replace('{langTag}', globalInfo.langTag).
      replace('{uid}', globalInfo.uid).
      replace('{mid}', globalInfo.mid).
      replace('{rid}', '').
      replace('{gid}', '').
      replace('{pid}', '').
      replace('{cid}', '').
      replace('{eid}', '').
      replace('{fid}', '').
      replace('{plid}', '').
      replace('{clid}', '').
      replace('{uploadToken}', '').
      replace('{uploadInfo}', '')

  },
  /**
   * 选择地址
   */
  onSelectLocation: function () {
    wx.getLocation({
      type: 'gcj02',
      success: (res) => {
        this.setData({ manualSelectLocation: true })

        const { longitude, latitude } = res
        const location = JSON.stringify({
          latitude: latitude,
          longitude: longitude,
        })
        const { tencentMapKey, tencentMapReferer } = appConfig
        wx.navigateTo({
          url: `plugin://chooseLocation/index?key=${tencentMapKey}&referer=${tencentMapReferer}&location=${location}`,
        })
      },
    })
  },
  /**
   * 切换是否匿名
   * @param isSelected
   */
  onSwitchAnonymous: function (isSelected) {
    this.data.currentDraft.isAnonymous = isSelected ? 1 : 0
    this.updateDraft()
  },
  /**
   * 页面事件捕捉
   * @param e
   */
  onClickEditor: function (e) {
    const editorToolbar = this.selectComponent('#editor-toolbar')
    editorToolbar.setData({
      showType: null,
    })
  },
})
