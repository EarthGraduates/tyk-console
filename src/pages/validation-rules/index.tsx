import { useState, useEffect, useCallback } from 'react';
import {
  Table, Typography, Tag, Space, Button, Modal, Form, Select, Input, message, Popconfirm, Empty,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  SettingOutlined, PlusOutlined, DeleteOutlined, ReloadOutlined, SafetyCertificateOutlined,
} from '@ant-design/icons';
import {
  listInterfaces, listFields, listRules, createRule, updateRule, deleteRule, refreshRules,
  type BizInterface, type InterfaceField, type ValidationRule,
} from '../../providers/validation-api';

const RULE_TYPE_LABELS: Record<string, string> = {
  regex: '正则校验',
  domain: '值域校验',
  cross_field: '跨字段校验',
};

export default function ValidationRulesPage() {
  const [interfaces, setInterfaces] = useState<BizInterface[]>([]);
  const [selectedIface, setSelectedIface] = useState<BizInterface | null>(null);
  const [fields, setFields] = useState<InterfaceField[]>([]);
  const [selectedField, setSelectedField] = useState<InterfaceField | null>(null);
  const [rules, setRules] = useState<ValidationRule[]>([]);
  const [loading, setLoading] = useState(false);
  const [ruleModalOpen, setRuleModalOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<ValidationRule | null>(null);
  const [form] = Form.useForm();
  const [refreshing, setRefreshing] = useState(false);

  // Load interfaces on mount
  useEffect(() => {
    listInterfaces().then(setInterfaces);
  }, []);

  // Load fields when interface selected
  const onSelectInterface = useCallback(async (iface: BizInterface) => {
    setSelectedIface(iface);
    setSelectedField(null);
    setRules([]);
    const f = await listFields(iface.id);
    setFields(f);
  }, []);

  // Load rules when field selected
  const onSelectField = useCallback(async (field: InterfaceField) => {
    setSelectedField(field);
    const r = await listRules(field.id);
    setRules(r);
  }, []);

  // Refresh cache
  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const result = await refreshRules();
      message.success(`规则缓存已刷新，共 ${result.rules_cached} 条`);
    } catch {
      message.error('刷新失败');
    } finally {
      setRefreshing(false);
    }
  }, []);

  // Open modal for create/edit
  const openRuleModal = useCallback((rule?: ValidationRule) => {
    setEditingRule(rule || null);
    if (rule) {
      form.setFieldsValue({
        rule_type: rule.rule_type,
        rule_config: JSON.stringify(rule.rule_config, null, 2),
        error_message: rule.error_message,
      });
    } else {
      form.resetFields();
    }
    setRuleModalOpen(true);
  }, [form]);

  // Save rule
  const handleSaveRule = useCallback(async () => {
    const values = await form.validateFields();
    let parsedConfig: Record<string, unknown>;
    try {
      parsedConfig = JSON.parse(values.rule_config);
    } catch {
      message.error('rule_config 不是合法的 JSON');
      return;
    }

    if (!selectedField) return;

    setLoading(true);
    try {
      if (editingRule) {
        await updateRule(editingRule.id, {
          rule_type: values.rule_type,
          rule_config: parsedConfig,
          error_message: values.error_message,
        });
        message.success('规则已更新');
      } else {
        await createRule({
          field_id: selectedField.id,
          rule_type: values.rule_type,
          rule_config: parsedConfig,
          error_message: values.error_message,
        });
        message.success('规则已创建');
      }
      setRuleModalOpen(false);
      await handleRefresh();
      // Reload rules for current field
      const r = await listRules(selectedField.id);
      setRules(r);
    } catch {
      message.error('保存失败');
    } finally {
      setLoading(false);
    }
  }, [form, editingRule, selectedField, handleRefresh]);

  // Delete rule
  const handleDeleteRule = useCallback(async (rule: ValidationRule) => {
    await deleteRule(rule.id);
    message.success('规则已删除');
    await handleRefresh();
    if (selectedField) {
      const r = await listRules(selectedField.id);
      setRules(r);
    }
  }, [selectedField, handleRefresh]);

  // Interface columns
  const ifaceColumns: ColumnsType<BizInterface> = [
    { title: '接口ID', dataIndex: 'interface_id', width: 140 },
    { title: '接口名称', dataIndex: 'interface_name', width: 220 },
    { title: '函数名', dataIndex: 'func_name', width: 250, render: (v: string) => <Typography.Text code>{v}</Typography.Text> },
    { title: '分类', dataIndex: 'category_code', width: 60, render: (v: string) => <Tag>{v}</Tag> },
    { title: '方向', dataIndex: 'data_flow', width: 60, render: (v: string) => <Tag color={v === 'O' ? 'blue' : 'green'}>{v === 'O' ? '出站' : '入站'}</Tag> },
    { title: '平台', dataIndex: 'platform', width: 60 },
    {
      title: '操作', key: 'action', width: 100,
      render: (_, r) => <Button size="small" icon={<SettingOutlined />} onClick={() => onSelectInterface(r)}>管理</Button>,
    },
  ];

  // Field columns
  const fieldColumns: ColumnsType<InterfaceField> = [
    { title: '字段路径', dataIndex: 'field_path', width: 180, render: (v: string) => <Typography.Text code>{v}</Typography.Text> },
    { title: '字段名', dataIndex: 'field_name', width: 150 },
    { title: '类型', dataIndex: 'field_type', width: 80 },
    { title: '方向', dataIndex: 'direction', width: 70, render: (v: string) => <Tag color={v === 'input' ? 'orange' : 'purple'}>{v === 'input' ? '入参' : '出参'}</Tag> },
    { title: '必填', dataIndex: 'required', width: 60, render: (v: boolean) => v ? <Tag color="red">是</Tag> : null },
    {
      title: '操作', key: 'action', width: 100,
      render: (_, r) => <Button size="small" icon={<SafetyCertificateOutlined />} onClick={() => onSelectField(r)}>规则</Button>,
    },
  ];

  // Rule columns
  const ruleColumns: ColumnsType<ValidationRule> = [
    { title: '规则类型', dataIndex: 'rule_type', width: 120, render: (v: string) => <Tag>{RULE_TYPE_LABELS[v] || v}</Tag> },
    { title: '规则配置', dataIndex: 'rule_config', ellipsis: true, render: (v: Record<string, unknown>) => <Typography.Text code>{JSON.stringify(v)}</Typography.Text> },
    { title: '错误提示', dataIndex: 'error_message', width: 200 },
    { title: '启用', dataIndex: 'is_active', width: 60, render: (v: boolean) => v ? <Tag color="green">启用</Tag> : <Tag>禁用</Tag> },
    {
      title: '操作', key: 'action', width: 140,
      render: (_, r) => (
        <Space>
          <Button size="small" onClick={() => openRuleModal(r)}>编辑</Button>
          <Popconfirm title="确定删除此规则？" onConfirm={() => handleDeleteRule(r)}>
            <Button size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <Typography.Title level={4} style={{ margin: 0 }}>
          <SafetyCertificateOutlined style={{ marginRight: 8 }} />
          校验规则管理
        </Typography.Title>
        <Button icon={<ReloadOutlined />} onClick={handleRefresh} loading={refreshing}>刷新规则缓存</Button>
      </div>

      {/* Interface table */}
      <div style={{ marginBottom: selectedIface ? 16 : 0 }}>
        <Typography.Text strong>接口列表（{interfaces.length}）</Typography.Text>
        <Table
          columns={ifaceColumns}
          dataSource={interfaces}
          rowKey="id"
          size="small"
          pagination={{ pageSize: 10, showSizeChanger: true }}
          scroll={{ x: 900 }}
          style={{ marginTop: 8 }}
          rowClassName={(r) => selectedIface?.id === r.id ? 'ant-table-row-selected' : ''}
        />
      </div>

      {/* Fields of selected interface */}
      {selectedIface && (
        <div style={{ marginBottom: selectedField ? 16 : 0, paddingLeft: 16, borderLeft: '3px solid #1677ff' }}>
          <Typography.Text strong>
            {selectedIface.interface_name}（{selectedIface.func_name}）的字段（{fields.length}）
          </Typography.Text>
          <Table
            columns={fieldColumns}
            dataSource={fields}
            rowKey="id"
            size="small"
            pagination={{ pageSize: 10 }}
            scroll={{ x: 700 }}
            style={{ marginTop: 8 }}
            rowClassName={(r) => selectedField?.id === r.id ? 'ant-table-row-selected' : ''}
          />
        </div>
      )}

      {/* Rules of selected field */}
      {selectedField && (
        <div style={{ paddingLeft: 16, borderLeft: '3px solid #52c41a' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <Typography.Text strong>
              {selectedField.field_path}（{selectedField.field_name}）的校验规则（{rules.length}）
            </Typography.Text>
            <Button type="primary" size="small" icon={<PlusOutlined />} onClick={() => openRuleModal()}>
              添加规则
            </Button>
          </div>
          {rules.length === 0 ? (
            <Empty description="暂无规则，点击添加" image={Empty.PRESENTED_IMAGE_SIMPLE} />
          ) : (
            <Table
              columns={ruleColumns}
              dataSource={rules}
              rowKey="id"
              size="small"
              pagination={false}
              scroll={{ x: 700 }}
            />
          )}
        </div>
      )}

      {/* Rule create/edit modal */}
      <Modal
        title={editingRule ? '编辑校验规则' : '添加校验规则'}
        open={ruleModalOpen}
        onCancel={() => setRuleModalOpen(false)}
        onOk={handleSaveRule}
        confirmLoading={loading}
        width={600}
      >
        <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item name="rule_type" label="规则类型" rules={[{ required: true }]}>
            <Select
              options={[
                { value: 'regex', label: '正则校验 (regex)' },
                { value: 'domain', label: '值域校验 (domain)' },
                { value: 'cross_field', label: '跨字段校验 (cross_field)' },
              ]}
            />
          </Form.Item>
          <Form.Item name="rule_config" label="规则配置 (JSON)" rules={[{ required: true }]}>
            <Input.TextArea
              rows={4}
              placeholder='{"pattern": "^[A-Z]{2,4}[0-9]{3,6}$"}'
            />
          </Form.Item>
          <Form.Item name="error_message" label="错误提示">
            <Input placeholder="校验失败时返回给客户端的提示信息" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
