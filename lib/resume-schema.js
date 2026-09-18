// 简历字段定义 — 单一事实来源
// 整个插件围绕这个 schema 工作:
//   - Options 页用它生成编辑表单
//   - Matcher 用它的 synonyms 做字段匹配
//   - Filler 用它把值写回表单
//
// 增加字段 → 只需在这里加,然后 matcher 的 synonyms 也会自动可用。

(function () {
  // 把每个字段描述成一个对象;其中 synonyms 用于表单字段名匹配。
  // type 决定:
  //   "text"      普通文本
  //   "textarea"  长文本
  //   "date"      日期(支持 YYYY / YYYY-MM / YYYY-MM-DD)
  //   "phone"     手机号
  //   "email"     邮箱
  //   "list"      列表项(数组,例如工作经历、项目经历)
  //   "number"    数字
  //   "enum"      枚举值(数组 → 字符串,例如性别/学历/政治面貌)

  const FIELDS = {
    personal: {
      label: '个人信息',
      icon: '👤',
      fields: {
        name:           { label: '姓名',           type: 'text',     synonyms: ['姓名', '名字', 'name', 'your name', 'full name', '真实姓名', '本人姓名', '中文姓名', 'candidate name'] },
        englishName:    { label: '英文名',         type: 'text',     synonyms: ['英文名', 'english name', 'pinyin', '拼音', 'first name', 'last name', 'given name'] },
        gender:         { label: '性别',           type: 'enum',     options: ['男', '女'], synonyms: ['性别', 'gender', 'sex'] },
        birthDate:      { label: '出生日期',       type: 'date',     synonyms: ['出生日期', '生日', '出生年月', 'birthday', 'date of birth', 'dob', '出生时间'] },
        phone:          { label: '手机号',         type: 'phone',    synonyms: ['手机', '手机号', '联系电话', '电话', 'phone', 'mobile', 'tel', 'cellphone', '手机号码', '联系手机'] },
        email:          { label: '邮箱',           type: 'email',    synonyms: ['邮箱', '电子邮件', 'email', 'e-mail', 'mail', '邮件地址'] },
        ethnicity:      { label: '民族',           type: 'text',     synonyms: ['民族', 'nation', 'ethnicity', 'nationality'] },
        political:      { label: '政治面貌',       type: 'enum',     options: ['群众', '共青团员', '中共党员', '中共预备党员', '民革党员', '民盟盟员', '民建会员', '民进会员', '农工党党员', '致公党党员', '九三学社社员', '台盟盟员', '无党派人士'], synonyms: ['政治面貌', '党派', 'political', 'political status'] },
        maritalStatus:  { label: '婚姻状况',       type: 'enum',     options: ['未婚', '已婚', '离异', '丧偶'], synonyms: ['婚姻', '婚姻状况', 'marital', 'marital status'] },
        hukouLocation:  { label: '籍贯/户籍',      type: 'text',     synonyms: ['籍贯', '户籍', '户籍所在地', 'hometown', 'birthplace', '出生地', '户口'] },
        currentCity:    { label: '现居城市',       type: 'text',     synonyms: ['现居地', '现居住地', '居住地', '所在地', '所在城市', '现居城市', 'current city', 'current location', 'city', 'location', 'address'] },
        height:         { label: '身高(cm)',        type: 'number',   synonyms: ['身高', 'height', 'body height'] },
        weight:         { label: '体重(kg)',        type: 'number',   synonyms: ['体重', 'weight', 'body weight'] },
        idCard:         { label: '身份证号',       type: 'text',     synonyms: ['身份证', '身份证号', '身份证号码', 'id card', 'id number', 'idcard'] }
      }
    },

    jobIntention: {
      label: '求职意向',
      icon: '🎯',
      fields: {
        desiredPosition:    { label: '期望岗位',     type: 'text',     synonyms: ['期望岗位', '求职意向', '意向岗位', 'desired position', 'position', 'job', '岗位'] },
        desiredIndustry:    { label: '期望行业',     type: 'text',     synonyms: ['期望行业', '行业', 'industry', 'desired industry'] },
        desiredCity:        { label: '期望城市',     type: 'text',     synonyms: ['期望城市', '期望地点', '期望工作地点', '工作地点', '工作城市', 'desired city', 'preferred city', 'work location'] },
        desiredSalary:      { label: '期望薪资',     type: 'text',     synonyms: ['期望薪资', '期望薪酬', '期望月薪', '薪资要求', 'salary', 'expected salary', 'compensation'] },
        availableDate:      { label: '到岗时间',     type: 'date',     synonyms: ['到岗时间', '到岗日期', '入职时间', 'available', 'available date', 'start date'] },
        jobType:            { label: '工作类型',     type: 'enum',     options: ['全职', '实习', '兼职', '校招', '社招'], synonyms: ['工作类型', '求职类型', 'job type', 'employment type'] }
      }
    },

    education: {
      label: '教育经历',
      icon: '🎓',
      type: 'list',
      itemFields: {
        school:     { label: '学校',     type: 'text',   synonyms: ['学校', '院校', '毕业院校', 'school', 'university', 'college', 'education school'] },
        major:      { label: '专业',     type: 'text',   synonyms: ['专业', '所学专业', 'major', 'subject', 'field of study'] },
        degree:     { label: '学历',     type: 'enum',   options: ['高中', '大专', '本科', '硕士', '博士', 'MBA', 'EMBA'], synonyms: ['学历', '学位', 'degree', 'education level', '学历层次'] },
        startDate:  { label: '开始时间', type: 'date',   synonyms: ['开始时间', '入学时间', 'start date', 'from', 'enrollment date'] },
        endDate:    { label: '结束时间', type: 'date',   synonyms: ['结束时间', '毕业时间', 'end date', 'to', 'graduation date'] },
        gpa:        { label: 'GPA',      type: 'text',   synonyms: ['gpa', '绩点', '成绩排名', 'rank', 'rankings'] },
        ranking:    { label: '排名',     type: 'text',   synonyms: ['排名', '专业排名', 'ranking', 'class rank'] },
        description:{ label: '描述',     type: 'textarea', synonyms: ['描述', '主修课程', '课程', 'description', 'courses', '在校经历'] }
      }
    },

    experience: {
      label: '实习/工作经历',
      icon: '💼',
      type: 'list',
      itemFields: {
        company:    { label: '公司',     type: 'text',   synonyms: ['公司', '单位', '企业', 'company', 'employer', 'organization'] },
        position:   { label: '岗位',     type: 'text',   synonyms: ['岗位', '职位', '职务', 'position', 'title', 'role', 'job title'] },
        startDate:  { label: '开始时间', type: 'date',   synonyms: ['开始时间', '入职时间', 'start date', 'from'] },
        endDate:    { label: '结束时间', type: 'date',   synonyms: ['结束时间', '离职时间', 'end date', 'to', '截止'] },
        location:   { label: '地点',     type: 'text',   synonyms: ['地点', '工作地点', 'location', 'city'] },
        description:{ label: '描述',     type: 'textarea', synonyms: ['描述', '工作描述', '职责', 'description', 'responsibility', 'duties', '工作内容'] }
      }
    },

    projects: {
      label: '项目经历',
      icon: '🚀',
      type: 'list',
      itemFields: {
        name:        { label: '项目名',   type: 'text',     synonyms: ['项目名', '项目名称', 'project name', 'project'] },
        role:        { label: '角色',     type: 'text',     synonyms: ['角色', '担任角色', 'role', 'position'] },
        startDate:   { label: '开始时间', type: 'date',     synonyms: ['开始时间', 'start date', 'from'] },
        endDate:     { label: '结束时间', type: 'date',     synonyms: ['结束时间', 'end date', 'to'] },
        techStack:   { label: '技术栈',   type: 'text',     synonyms: ['技术栈', '技术', 'tech stack', 'technology', 'technologies'] },
        description: { label: '描述',     type: 'textarea', synonyms: ['描述', '项目描述', 'description', 'responsibility', '项目介绍'] },
        link:        { label: '链接',     type: 'text',     synonyms: ['链接', 'url', 'link', 'demo', 'github'] }
      }
    },

    skills: {
      label: '技能',
      icon: '🛠️',
      type: 'list',
      itemFields: {
        name:  { label: '技能名', type: 'text', synonyms: ['技能', '技能名', 'skill', '技术能力', 'it技能'] },
        level: { label: '熟练度', type: 'enum', options: ['了解', '熟悉', '掌握', '精通'], synonyms: ['熟练度', 'level', 'proficiency'] }
      }
    },

    awards: {
      label: '获奖经历',
      icon: '🏆',
      type: 'list',
      itemFields: {
        name:     { label: '奖项名',   type: 'text',     synonyms: ['奖项', '奖项名称', 'award', 'honor'] },
        level:    { label: '级别',     type: 'text',     synonyms: ['级别', '等级', 'level'] },
        date:     { label: '时间',     type: 'date',     synonyms: ['时间', '获奖时间', 'date'] },
        issuer:   { label: '颁发方',   type: 'text',     synonyms: ['颁发方', '颁发机构', 'issuer', 'awarded by'] }
      }
    },

    certificates: {
      label: '证书',
      icon: '📜',
      type: 'list',
      itemFields: {
        name: { label: '证书名', type: 'text', synonyms: ['证书', '证书名称', 'certificate', 'certification'] },
        date: { label: '时间',   type: 'date', synonyms: ['时间', '获得时间', 'date'] }
      }
    },

    languages: {
      label: '语言能力',
      icon: '🗣️',
      type: 'list',
      itemFields: {
        language: { label: '语言', type: 'text', synonyms: ['语言', 'language', '外语'] },
        level:    { label: '等级', type: 'text', synonyms: ['等级', 'level', '成绩', 'score'] }
      }
    },

    selfIntro: {
      label: '自我评价',
      icon: '📝',
      fields: {
        summary:  { label: '自我介绍',   type: 'textarea', synonyms: ['自我介绍', '自我评价', '简介', 'bio', 'introduction', 'self introduction', 'self-evaluation', 'summary', 'about me'] },
        hobbies:  { label: '兴趣爱好',   type: 'textarea', synonyms: ['兴趣爱好', '爱好', 'hobbies', 'interests'] },
        strengths:{ label: '个人优势',   type: 'textarea', synonyms: ['个人优势', '优势', 'strengths', 'advantages'] }
      }
    }
  };

  // 暴露给其它模块
  if (typeof window !== 'undefined') {
    window.ResumeSchema = FIELDS;
  }
  if (typeof self !== 'undefined') {
    self.ResumeSchema = FIELDS;
  }
})();
