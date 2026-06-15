/**
 * 标本接收登记 — 中心技师扫描条码，核查标本，接收/拒收/让步
 */
import { useState } from 'react';
import {
  Card, Input, Button, Space, Typography, Descriptions, Tag, Divider,
  Radio, message, Spin,
} from 'antd';
import { SearchOutlined, CheckCircleOutlined, CloseCircleOutlined, ExclamationCircleOutlined } from '@ant-design/icons';
import { labSpecimenDb } from '../../../../providers/lab-db';

export default function SpecimenReceivePage() {
  const [barcode, setBarcode] = useState('');
  const [loading, setLoading] = useState(false);
  const [specimen, setSpecimen] = useState<any>(null);
  const [action, setAction] = useState<string>('accept');
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSearch = async () => {
    if (!barcode.trim()) return;
    setLoading(true);
    setSpecimen(null);
    try {
      const res = await labSpecimenDb.getByBarcode(barcode.trim());
      const item = res?.dataInfoList?.[0];
      if (item) {
        setSpecimen(item);
      } else {
        message.warning('未找到该条码的标本信息');
      }
    } catch (e: any) {
      message.error(e.message || '查询失败');
    } finally {
      setLoading(false);
    }
  };

  const handleReceive = async () => {
    if (!specimen) return;
    setSubmitting(true);
    try {
      const res = await labSpecimenDb.receive({
        doctAdviseNo: specimen.doctAdviseNo || barcode.trim(),
        receiveFlag: 'A',
        status: action === 'accept' ? 1 : action === 'reject' ? 3 : 5,
        receiver: 'CT001',
        receiverName: '中心技师',
        receiveTime: new Date().toISOString(),
        reason: action !== 'accept' ? reason : null,
      });
      if (res.code === 200) {
        message.success(action === 'accept' ? '标本接收成功' : '已登记');
        setSpecimen(null);
        setBarcode('');
      } else {
        message.error(res.message || '操作失败');
      }
    } catch (e: any) {
      message.error(e.message || '操作失败');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={{ padding: 24 }}>
      <Card title="标本接收登记">
        <Space style={{ marginBottom: 16 }}>
          <Input
            placeholder="输入条码号"
            prefix={<SearchOutlined />}
            value={barcode}
            onChange={e => setBarcode(e.target.value)}
            onPressEnter={handleSearch}
            style={{ width: 320 }}
          />
          <Button type="primary" onClick={handleSearch} loading={loading}>查询</Button>
        </Space>

        {loading && <Spin style={{ display: 'block', margin: '40px auto' }} />}

        {specimen && (
          <Card size="small" title="标本详情" style={{ marginTop: 16 }}>
            <Descriptions bordered column={3} size="small">
              <Descriptions.Item label="条码号">{specimen.doctAdviseNo}</Descriptions.Item>
              <Descriptions.Item label="患者姓名">{specimen.patientName}</Descriptions.Item>
              <Descriptions.Item label="性别">{specimen.sex}</Descriptions.Item>
              <Descriptions.Item label="年龄">{specimen.age}</Descriptions.Item>
              <Descriptions.Item label="标本类型">{specimen.sampleType}</Descriptions.Item>
              <Descriptions.Item label="临床诊断">{specimen.diagnostic || '—'}</Descriptions.Item>
              <Descriptions.Item label="送检机构">{specimen.sendingOrg}</Descriptions.Item>
              <Descriptions.Item label="采集机构">{specimen.collectingOrgCode || specimen.sendingOrg || '—'}</Descriptions.Item>
              <Descriptions.Item label="采集者">{specimen.executorName || '—'}</Descriptions.Item>
              <Descriptions.Item label="申请模式">
                <Tag color={specimen.requestMode === 2 ? 'red' : 'blue'}>
                  {specimen.requestMode === 2 ? '急诊' : '平诊'}
                </Tag>
              </Descriptions.Item>
              <Descriptions.Item label="备注">{specimen.notes || '—'}</Descriptions.Item>
            </Descriptions>

            <Divider titlePlacement="start">核查操作</Divider>
            <Radio.Group
              value={action}
              onChange={e => { setAction(e.target.value); setReason(''); }}
              buttonStyle="solid"
              style={{ marginBottom: 16 }}
            >
              <Radio.Button value="accept">
                <CheckCircleOutlined /> 合格接收
              </Radio.Button>
              <Radio.Button value="reject">
                <CloseCircleOutlined /> 不合格拒收
              </Radio.Button>
              <Radio.Button value="concession">
                <ExclamationCircleOutlined /> 让步接收
              </Radio.Button>
            </Radio.Group>

            {action !== 'accept' && (
              <Input.TextArea
                placeholder={action === 'reject' ? '拒收原因（如溶血、量不足、容器错误等）' : '让步原因'}
                value={reason}
                onChange={e => setReason(e.target.value)}
                rows={3}
                style={{ marginBottom: 16 }}
              />
            )}

            <Button type="primary" onClick={handleReceive} loading={submitting}>
              确认登记
            </Button>
          </Card>
        )}
      </Card>
    </div>
  );
}
