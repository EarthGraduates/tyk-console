/**
 * 申请受理 — 中心技师查看待受理申请，审核通过后生成条码并更新状态
 */
import { useState, useEffect, useMemo } from 'react';
import {
  Table, Card, Button, Modal, Space, Input, Typography, Tag, message,
} from 'antd';
import { SearchOutlined, CheckCircleOutlined, CloseCircleOutlined } from '@ant-design/icons';
import { labApplicationDb } from '../../../../providers/lab-db';

function generateBarcode(orgSending: string): string {
  const now = new Date();
  const y = String(now.getFullYear());
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const seq = String(Math.floor(Math.random() * 9000) + 1000);
  return `${orgSending || 'ORG'}-${y}${m}${d}-${seq}`;
}

const STATUS_MAP: Record<string, { color: string; label: string }> = {
  submitted: { color: 'blue', label: '待受理' },
  accepted: { color: 'green', label: '已受理' },
  rejected: { color: 'red', label: '已退回' },
  collected: { color: 'cyan', label: '已采集' },
  sent: { color: 'purple', label: '已送检' },
};

export default function ApplicationReviewPage() {
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [reviewModal, setReviewModal] = useState<{ open: boolean; record?: any; action?: string }>({ open: false });
  const [rejectReason, setRejectReason] = useState('');

  const fetchData = () => {
    setLoading(true);
    labApplicationDb.list({ status: 'submitted' })
      .then(res => setData(res?.dataInfoList || []))
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchData(); }, []);

  const filtered = useMemo(() => {
    if (!search) return data;
    const s = search.toLowerCase();
    return data.filter((r: any) =>
      r.applicationId?.toLowerCase().includes(s) ||
      r.patientName?.toLowerCase().includes(s) ||
      r.patientId?.toLowerCase().includes(s)
    );
  }, [data, search]);

  const handleReview = async () => {
    const { record, action } = reviewModal;
    if (!record) return;
    try {
      const barcode = action === 'accept' ? generateBarcode(record.sendingOrg || record.org_sending || 'ORG') : undefined;
      const payload: any = {
        applicationId: record.applicationId,
        sendingOrg: record.org_sending || 'NX-HOSP-001',
        status: action === 'accept' ? 'accepted' : 'rejected',
        doctAdviseNo: barcode || null,
        patientName: record.patientName,
        sex: record.sex,
        age: record.age,
        patientId: record.patientId,
        patientPhone: record.patientPhone,
        patientType: record.patientType,
        diagnostic: record.diagnostic,
        bedNo: record.bedNo,
        wardName: record.wardName,
        sectionName: record.sectionName,
        requestMode: record.requestMode,
        requester: record.requester,
        requestTime: record.requestTime,
        sendFlag: 0,
        reason: action === 'reject' ? rejectReason : null,
        itemInfoList: record.itemInfoList || [],
      };
      const res = await labApplicationDb.submit(payload);
      if (res.code === 200) {
        message.success(action === 'accept'
          ? `受理成功，条码号: ${barcode}`
          : '已退回申请');
        setReviewModal({ open: false });
        setRejectReason('');
        fetchData();
      } else {
        message.error(res.message || '操作失败');
      }
    } catch (e: any) {
      message.error(e.message || '操作失败');
    }
  };

  return (
    <div style={{ padding: 24 }}>
      <Card title="待受理列表">
        <Space style={{ marginBottom: 16 }}>
          <Input
            placeholder="搜索申请号/患者"
            prefix={<SearchOutlined />}
            value={search}
            onChange={e => setSearch(e.target.value)}
            allowClear
            style={{ width: 280 }}
          />
        </Space>
        <Typography.Text type="secondary" style={{ marginLeft: 16 }}>
          共 {filtered.length} 条待受理
        </Typography.Text>
        <Table
          dataSource={filtered}
          loading={loading}
          rowKey="applicationId"
          columns={[
            { title: '申请单号', dataIndex: 'applicationId', width: 180 },
            { title: '患者姓名', dataIndex: 'patientName', width: 100 },
            { title: '性别', dataIndex: 'sex', width: 60 },
            { title: '年龄', dataIndex: 'age', width: 60 },
            { title: '样本类型', dataIndex: 'itemInfoList', width: 120,
              render: (items: any[]) => items?.map((i: any) => i.sampleType).filter(Boolean).join(', ') || '-',
            },
            { title: '开单科室', dataIndex: 'sectionName', width: 120 },
            { title: '申请模式', dataIndex: 'requestMode', width: 80,
              render: (v: string) => <Tag color={v === '急诊' ? 'red' : 'blue'}>{v}</Tag>,
            },
            { title: '状态', dataIndex: 'status', width: 100,
              render: (v: string) => {
                const s = STATUS_MAP[v] || { color: 'default', label: v };
                return <Tag color={s.color}>{s.label}</Tag>;
              },
            },
            { title: '申请时间', dataIndex: 'requestTime', width: 170 },
            { title: '操作', width: 160, render: (_: any, record: any) => (
              <Space>
                <Button
                  type="primary"
                  size="small"
                  icon={<CheckCircleOutlined />}
                  onClick={() => setReviewModal({ open: true, record, action: 'accept' })}
                >
                  受理
                </Button>
                <Button
                  danger
                  size="small"
                  icon={<CloseCircleOutlined />}
                  onClick={() => { setReviewModal({ open: true, record, action: 'reject' }); setRejectReason(''); }}
                >
                  退回
                </Button>
              </Space>
            )},
          ]}
          pagination={{ pageSize: 20 }}
        />
      </Card>

      <Modal
        title={reviewModal.action === 'accept' ? '确认受理' : '退回申请'}
        open={reviewModal.open}
        onOk={handleReview}
        onCancel={() => setReviewModal({ open: false })}
        okText={reviewModal.action === 'accept' ? '确认受理' : '确认退回'}
        okButtonProps={{ danger: reviewModal.action === 'reject' }}
      >
        {reviewModal.action === 'accept' && (
          <p>确认受理 <strong>{reviewModal.record?.patientName}</strong> 的检验申请？系统将自动生成条码号。</p>
        )}
        {reviewModal.action === 'reject' && (
          <>
            <p>确认退回 <strong>{reviewModal.record?.patientName}</strong> 的检验申请？</p>
            <Input.TextArea
              placeholder="请输入退回原因"
              value={rejectReason}
              onChange={e => setRejectReason(e.target.value)}
              rows={3}
              style={{ marginTop: 8 }}
            />
          </>
        )}
      </Modal>
    </div>
  );
}
