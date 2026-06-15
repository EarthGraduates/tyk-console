/**
 * 报告二审详情 — 审核操作（通过/驳回），含同人校验 + 夜班开关
 */
import { useState, useEffect } from 'react';
import {
  Card, Descriptions, Table, Tag, Button, Space, Input, Switch, message, Spin, Typography,
} from 'antd';
import { useParams, useNavigate } from 'react-router';
import { CheckCircleOutlined, CloseCircleOutlined } from '@ant-design/icons';
import { labReportDb } from '../../../../providers/lab-db';

export default function SecondReviewDetailPage() {
  const { rptId } = useParams<{ rptId: string }>();
  const navigate = useNavigate();
  const [report, setReport] = useState<any>(null);
  const [opinion, setOpinion] = useState('');
  const [nightShift, setNightShift] = useState(false);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!rptId) return;
    setLoading(true);
    fetch(`http://localhost:3001/lab_test_reports?rpt_id=eq.${rptId}`, {
      headers: { 'Content-Type': 'application/json' },
    }).then(r => r.json()).then(async rows => {
      if (rows?.[0]) {
        const rpt = rows[0];
        const subs = await Promise.all([
          fetch(`http://localhost:3001/lab_report_result_items?report_id=eq.${rpt.id}&limit=200`).then(r => r.json()),
          fetch(`http://localhost:3001/lab_report_anti_items?report_id=eq.${rpt.id}&limit=200`).then(r => r.json()),
        ]);
        setReport({ ...rpt, results: subs[0], antis: subs[1] });
      }
      setLoading(false);
    });
  }, [rptId]);

  const handleReview = async (action: string) => {
    if (!rptId) return;
    if (action === 'reject' && !opinion.trim()) {
      message.warning('驳回时请填写审核意见');
      return;
    }
    setSubmitting(true);
    try {
      const res = await labReportDb.submitSecondReview({
        reportId: rptId,
        reviewer: 'R002',
        reviewerName: '二审员',
        reviewOpinion: opinion,
        reviewTime: new Date().toISOString(),
        nightShift,
        action,
      });
      if (res.code === 200) {
        message.success(action === 'approve' ? '二审通过，报告已签发' : '已驳回');
        navigate('/business/lab/reviews/second-review');
      } else {
        message.error(res.message || '操作失败');
      }
    } catch (e: any) {
      message.error(e.message || '操作失败');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <Spin style={{ display: 'block', margin: '80px auto' }} size="large" />;
  if (!report) return <Typography.Text>报告未找到</Typography.Text>;

  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: 'flex', gap: 24 }}>
        <div style={{ flex: 1 }}>
          <Card title={`二审: ${report.rpt_id}`} extra={<Tag color="orange">待二审</Tag>}>
            <Descriptions bordered column={2} size="small" style={{ marginBottom: 16 }}>
              <Descriptions.Item label="患者">{report.pt_name}</Descriptions.Item>
              <Descriptions.Item label="条码号">{report.sp_barcode}</Descriptions.Item>
              <Descriptions.Item label="一审者">{report.chk_name || '—'}</Descriptions.Item>
              <Descriptions.Item label="一审意见">{report.chk_opinion || '—'}</Descriptions.Item>
              <Descriptions.Item label="送检机构">{report.org_sending_name || report.org_sending}</Descriptions.Item>
              <Descriptions.Item label="标本类型">{report.sp_type}</Descriptions.Item>
              <Descriptions.Item label="让步标识">{report.cnc_flag ? <Tag color="orange">让步</Tag> : '正常'}</Descriptions.Item>
            </Descriptions>
            <Table dataSource={report.results || []} rowKey="id" size="small" pagination={false}
              columns={[
                { title: '项目', dataIndex: 'chinese_name', width: 160 },
                { title: '结果值', dataIndex: 'test_result', width: 100 },
                { title: '参考范围', dataIndex: 'ref_range', width: 140 },
                { title: '单位', dataIndex: 'unit', width: 60 },
                { title: '提示', dataIndex: 'hint', width: 80, render: (v: string) => v ? <Tag color="red">{v}</Tag> : '—' },
              ]}
            />
          </Card>
        </div>
        <div style={{ width: 320 }}>
          <Card title="审核操作">
            <div style={{ marginBottom: 16 }}>
              <Switch checked={nightShift} onChange={setNightShift} checkedChildren="夜班" unCheckedChildren="白班" />
              <Typography.Text type="secondary" style={{ marginLeft: 8 }}>夜班模式可跳过同人校验</Typography.Text>
            </div>
            <Input.TextArea
              placeholder="审核意见"
              value={opinion}
              onChange={e => setOpinion(e.target.value)}
              rows={4}
              style={{ marginBottom: 16 }}
            />
            <Space direction="vertical" style={{ width: '100%' }}>
              <Button type="primary" icon={<CheckCircleOutlined />} block loading={submitting}
                onClick={() => handleReview('approve')}>
                审核通过（签发）
              </Button>
              <Button danger icon={<CloseCircleOutlined />} block loading={submitting}
                onClick={() => handleReview('reject')}>
                驳回（退回临检方）
              </Button>
            </Space>
          </Card>
        </div>
      </div>
    </div>
  );
}
