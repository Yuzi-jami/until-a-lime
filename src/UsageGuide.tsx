export default function UsageGuide() {
  return (
    <section className="usage-guide">
      <span className="eyebrow">UNTIL / A LIME — 1.1.0</span>
      <h2>直到密码变成一颗酸橙</h2>
      <p>让账号随手可用。</p>
      <details>
        <summary>使用方法</summary>
        <details>
          <summary>保存与生成密码</summary>
          <p>
            橙子轮盘选择“保存账号”，填写网站、账号和密码。分类可留空，默认归入未分类；密码框旁的“生成”可以创建新密码。注册完成后再保存。
          </p>
        </details>
        <details>
          <summary>填写账号</summary>
          <p>
            轮盘选择“寻找账号”，点击账号复制用户名。在目标应用按 Ctrl + V，20
            秒内按 Tab 切换到密码框，再按 Ctrl + V。仅适用于允许粘贴的输入框。
          </p>
        </details>
        <details>
          <summary>整理分类</summary>
          <p>
            单个账号在详情里更换分组。批量整理进入“整理分类”：按建议整理用于核对网站用途，手动分组用于选中多条后移动到一个分类。
          </p>
        </details>
        <details>
          <summary>浏览器填写</summary>
          <p>
            在“浏览器插件”中完成一次连接和安装。收藏室解锁后，点击网站登录框即可选择账号填写。当前子站与上次使用的账号优先。提交新账号或修改密码后，确认网站操作成功，再点击酸橙提示保存；也可从插件选择“保存当前页面账号”。
          </p>
        </details>
        <details>
          <summary>后台与锁定</summary>
          <p>
            关闭主窗口会隐藏到托盘。手动锁定、闲置超时或退出后需要重新验证主密码。退出应用和重置橙子位置可在托盘菜单中操作。
          </p>
        </details>
        <details>
          <summary>备份</summary>
          <p>
            在设置中导出加密备份。主密码不会保存，忘记后无法恢复；请妥善保管备份和主密码。
          </p>
        </details>
      </details>
    </section>
  );
}
