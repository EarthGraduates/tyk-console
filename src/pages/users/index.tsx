/**
 * 用户管理页
 *
 * system_admin: 完整 CRUD + 角色/安全等级分配 + 启用/停用/重置密码
 * security_admin: 仅查看 + 修改角色/安全等级
 */

import { useState, useEffect, useCallback } from 'react';
import {
  Card, Table, Tag, Button, Space, Modal, Form, Input, Select,
  Typography, Popconfirm, message, Tooltip,
} from 'antd';
import { PlusOutlined, EditOutlined, LockOutlined, StopOutlined, CheckCircleOutlined, DeleteOutlined } from '@ant-design/icons';
import { usersDb, type UserRecord } from '../../providers/ichse-db';
import { usePermissions, ROLES } from '../../providers/permissions';

const { Text } = Typography;

const ROLE_LABELS: Record<string, string> = {
  system_admin: '系统管理员',
  security_admin: '安全管理员',
  audit_admin: '审计管理员',
  business_user: '业务用户',
  viewer: '观察者',
};

const ROLE_COLORS: Record<string, string> = {
  system_admin: 'red',
  security_admin: 'orange',
  audit_admin: 'purple',
  business_user: 'blue',
  viewer: 'default',
};

const SECRET_LEVELS = ['公开', '内部', '敏感', '机密'];
const STATUS_OPTIONS = [
  { label: '正常', value: 'active' },
  { label: '停用', value: 'disabled' },
  { label: '锁定', value: 'locked' },
];

export default function UsersPage() {
  const { isSystemAdmin, isSecurityAdmin } = usePermissions();
  const [users, setUsers] = useState<UserRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<UserRecord | null>(null);
  const [form] = Form.useForm();

  const fetchUsers = useCallback(async () => {
    try {
      const list = await usersDb.list();
      setUsers(list);
    } catch (e: any) {
      message.error(e.message || '获取用户列表失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchUsers(); }, [fetchUsers]);

  const openCreate = () => {
    setEditingUser(null);
    form.resetFields();
    form.setFieldsValue({ role: 'business_user', secret_level: '内部', status: 'active' });
    setModalOpen(true);
  };

  const openEdit = (user: UserRecord) => {
    setEditingUser(user);
    form.setFieldsValue({
      email: user.email,
      phone: user.phone,
      display_name: user.display_name,
      role: user.role,
      secret_level: user.secret_level,
      status: user.status,
    });
    setModalOpen(true);
  };

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      if (editingUser) {
        // security_admin 只能改 role + secret_level
        const updates: any = {};
        if (isSecurityAdmin) {
          if (values.role) updates.role = values.role;
          if (values.secret_level) updates.secret_level = values.secret_level;
        } else {
          Object.assign(updates, values);
        }
        await usersDb.update(editingUser.id, updates);
        message.success('用户更新成功');
      } else {
        await usersDb.create(values);
        message.success('用户创建成功');
      }
      setModalOpen(false);
      fetchUsers();
    } catch (e: any) {
      if (e.message && !e.errorFields) message.error(e.message);
    }
  };

  const handleToggle = async (user: UserRecord) => {
    try {
      if (user.status === 'disabled') {
        await usersDb.enable(user.id);
        message.success('用户已启用');
      } else {
        await usersDb.disable(user.id);
        message.success('用户已停用');
      }
      fetchUsers();
    } catch (e: any) {
      message.error(e.message);
    }
  };

  const handleResetPassword = (user: UserRecord) => {
    Modal.confirm({
      title: `重置密码: ${user.display_name}`,
      content: (
        <Input.Password
          id="reset-pwd-input"
          placeholder="输入新密码（至少8位，含字母+数字）"
          style={{ marginTop: 12 }}
        />
      ),
      onOk: async () => {
        const input = document.getElementById('reset-pwd-input') as HTMLInputElement;
        const pwd = input?.value;
        if (!pwd || pwd.length < 8) {
          message.warning('密码至少8位');
          return Promise.reject();
        }
        await usersDb.resetPassword(user.id, pwd);
        message.success('密码已重置');
        fetchUsers();
      },
    });
  };

  const handleDelete = async (user: UserRecord) => {
    try {
      await usersDb.delete(user.id);
      message.success('用户已删除');
      fetchUsers();
    } catch (e: any) {
      message.error(e.message);
    }
  };

  const columns = [
    { title: '名称', dataIndex: 'display_name', key: 'display_name', ellipsis: true },
    { title: '邮箱', dataIndex: 'email', key: 'email', ellipsis: true },
    {
      title: '角色', dataIndex: 'role', key: 'role', width: 100,
      render: (r: string) => r ? <Tag color={ROLE_COLORS[r] || 'default'}>{ROLE_LABELS[r] || r}</Tag> : '-',
    },
    {
      title: '安全等级', dataIndex: 'secret_level', key: 'secret_level', width: 80,
      render: (l: string) => l || '-',
    },
    {
      title: '状态', dataIndex: 'status', key: 'status', width: 80,
      render: (s: string) => {
        if (s === 'active') return <Tag color="green">正常</Tag>;
        if (s === 'disabled') return <Tag color="default">已停用</Tag>;
        if (s === 'locked') return <Tag color="red">已锁定</Tag>;
        return <Tag>{s}</Tag>;
      },
    },
    {
      title: '最后登录', dataIndex: 'last_login_at', key: 'last_login_at', width: 160,
      render: (t: string) => t ? new Date(t).toLocaleString() : '-',
    },
    {
      title: '操作', key: 'actions', width: isSystemAdmin ? 200 : 80,
      render: (_: any, record: UserRecord) => (
        <Space size="small">
          {isSystemAdmin && (
            <>
              <Tooltip title="编辑"><Button size="small" icon={<EditOutlined />} onClick={() => openEdit(record)} /></Tooltip>
              <Tooltip title={record.status === 'disabled' ? '启用' : '停用'}>
                <Popconfirm
                  title={record.status === 'disabled' ? '确认启用该用户？' : '确认停用该用户？'}
                  onConfirm={() => handleToggle(record)}
                >
                  <Button
                    size="small"
                    icon={record.status === 'disabled' ? <CheckCircleOutlined /> : <StopOutlined />}
                    danger={record.status !== 'disabled'}
                  />
                </Popconfirm>
              </Tooltip>
              <Tooltip title="重置密码">
                <Button size="small" icon={<LockOutlined />} onClick={() => handleResetPassword(record)} />
              </Tooltip>
              <Tooltip title="删除">
                <Popconfirm title="确认删除该用户？此操作不可恢复" onConfirm={() => handleDelete(record)}>
                  <Button size="small" icon={<DeleteOutlined />} danger />
                </Popconfirm>
              </Tooltip>
            </>
          )}
          {isSecurityAdmin && (
            <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(record)}>角色/等级</Button>
          )}
        </Space>
      ),
    },
  ];

  return (
    <div style={{ padding: 24 }}>
      <Card
        title="用户管理"
        extra={
          isSystemAdmin && (
            <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>新建用户</Button>
          )
        }
      >
        <Table
          dataSource={users}
          columns={columns}
          rowKey="id"
          loading={loading}
          pagination={{ pageSize: 15 }}
          size="small"
        />
      </Card>

      <Modal
        title={editingUser ? '编辑用户' : '新建用户'}
        open={modalOpen}
        onOk={handleSubmit}
        onCancel={() => setModalOpen(false)}
        destroyOnClose
        width={480}
      >
        <Form form={form} layout="vertical">
          <Form.Item name="email" label="邮箱" rules={editingUser ? [] : [{ required: true, type: 'email', message: '请输入有效邮箱' }]}>
            <Input disabled={!!editingUser && isSecurityAdmin} placeholder="user@example.com" />
          </Form.Item>
          {!editingUser && (
            <Form.Item name="password" label="密码" rules={[{ required: true, min: 8, message: '密码至少8位' }]}>
              <Input.Password placeholder="至少8位字符" />
            </Form.Item>
          )}
          <Form.Item name="phone" label="手机号">
            <Input disabled={isSecurityAdmin} placeholder="选填" />
          </Form.Item>
          <Form.Item name="display_name" label="显示名称" rules={[{ required: true, message: '请输入显示名称' }]}>
            <Input disabled={isSecurityAdmin} placeholder="用户显示名称" />
          </Form.Item>
          <Form.Item name="role" label="角色">
            <Select disabled={isSecurityAdmin && !editingUser} options={ROLES.map(r => ({ label: `${ROLE_LABELS[r]} (${r})`, value: r }))} />
          </Form.Item>
          <Form.Item name="secret_level" label="安全等级">
            <Select options={SECRET_LEVELS.map(l => ({ label: l, value: l }))} />
          </Form.Item>
          {isSystemAdmin && (
            <Form.Item name="status" label="状态">
              <Select options={STATUS_OPTIONS} />
            </Form.Item>
          )}
        </Form>
      </Modal>
    </div>
  );
}
